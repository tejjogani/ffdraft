/**
 * The shape every reference search provider has: search by words, and re-read one result by its
 * key (so a saved reference's rights come from the provider, never from what a browser echoed).
 * Providers only build addresses and map answers; how bytes travel is the {@link ProviderIO}
 * they are handed, the network in a real server and recorded answers in tests and fixture mode.
 */
import type { SearchResult } from '@pave/schema'

export interface ProviderQuery {
  query: string
  /** Only results whose pictures may be kept and sent to AI (CC0, public domain). */
  openOnly: boolean
  page: number
  limit: number
}

export interface ProviderIO {
  /** GETs a JSON document; throws {@link ProviderError} for anything but a 200 answer. */
  json(url: string, headers?: Record<string, string>): Promise<unknown>
}

/** A provider could not answer. `status` 404 means the item is gone. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export interface SearchProvider {
  /** Stable id stored in each reference's provenance, e.g. `met`. */
  id: string
  /** How the studio names it. */
  label: string
  search(q: ProviderQuery, io: ProviderIO): Promise<SearchResult[]>
  /** The current version of one result, or null when the provider no longer has it. */
  resolve(key: string, io: ProviderIO): Promise<SearchResult | null>
}

export const CC0 = 'CC0 1.0 (public domain)'
export const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/'

/** The item id inside a `provider:id` key, or null when the key is not this provider's. */
export function itemId(provider: string, key: string): string | null {
  const prefix = `${provider}:`
  if (!key.startsWith(prefix)) return null
  const id = key.slice(prefix.length)
  // Ids are numbers at all three museums; anything else could smuggle a path into an address.
  return /^\d{1,12}$/.test(id) ? id : null
}

/** A credit line from its parts, skipping the empty ones: "Maker, date. Museum, credit line". */
export function creditLine(maker: unknown, date: unknown, museum: string, credit: unknown): string {
  const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s*\n\s*/g, ', ').trim() : '')
  const who = [text(maker), text(date)].filter(Boolean).join(', ')
  const where = [museum, text(credit)].filter(Boolean).join(', ')
  return who ? `${who}. ${where}` : where
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
export const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}
export const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
