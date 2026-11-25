/**
 * The `search` service: fans a query out to the reference providers at once and gathers what
 * comes back. A provider that fails or is slow is listed in `unavailable` with a plain reason;
 * it never fails the search. The three museums need no key, so this is always registered.
 */
import type { CommandOutput, SearchResult } from '@pave/schema'
import type { SearchService } from '../services'
import { aic } from './aic'
import { cleveland } from './cleveland'
import { met } from './met'
import { ProviderError, type ProviderIO, type SearchProvider } from './provider'

export const MUSEUMS: readonly SearchProvider[] = [met, aic, cleveland]

/** A provider gets this long per search before it is reported as too slow. */
const PROVIDER_TIMEOUT_MS = 12_000
export const PAGE_SIZE = 12

export interface SearchOptions {
  io: ProviderIO
  providers?: readonly SearchProvider[]
  timeoutMs?: number
}

class TooSlow extends Error {}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TooSlow()), ms)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
    // The loser's rejection is handled, so a late failure is not an unhandled rejection.
    work.catch(() => {})
  }
}

const reasonOf = (p: SearchProvider, err: unknown) =>
  err instanceof TooSlow
    ? `${p.label} took too long to answer`
    : err instanceof ProviderError
      ? `${p.label} ${err.message}`
      : `${p.label} could not be searched`

export function createSearchService(opts: SearchOptions): SearchService {
  const providers = opts.providers ?? MUSEUMS
  const timeoutMs = opts.timeoutMs ?? PROVIDER_TIMEOUT_MS
  const byId = new Map(providers.map((p) => [p.id, p]))
  return {
    capabilities: { imageSearch: providers.map((p) => p.id) },

    async search(input) {
      const asked = input.providers?.length ? input.providers : providers.map((p) => p.id)
      const unavailable: CommandOutput<'references.search'>['unavailable'] = []
      const chosen: SearchProvider[] = []
      for (const id of new Set(asked)) {
        const p = byId.get(id)
        if (p) chosen.push(p)
        else unavailable.push({ provider: id, reason: `“${id}” is not a search provider here` })
      }
      const settled = await Promise.allSettled(
        chosen.map((p) =>
          withDeadline(
            p.search(
              { query: input.query, openOnly: input.openOnly, page: input.page, limit: PAGE_SIZE },
              opts.io,
            ),
            timeoutMs,
          ),
        ),
      )
      const results: SearchResult[] = []
      settled.forEach((s, i) => {
        const p = chosen[i]!
        if (s.status === 'rejected') {
          unavailable.push({ provider: p.id, reason: reasonOf(p, s.reason) })
          return
        }
        // Belt and braces: a provider's own filter may not cover every item.
        results.push(...(input.openOnly ? s.value.filter((r) => r.mayStore) : s.value))
      })
      return {
        results,
        providers: chosen.filter((_, i) => settled[i]!.status === 'fulfilled').map((p) => p.id),
        unavailable,
      }
    },

    async resolve({ provider, key }) {
      const p = byId.get(provider)
      if (!p || !key.startsWith(`${provider}:`)) return null
      return withDeadline(p.resolve(key, opts.io), timeoutMs)
    },
  }
}
