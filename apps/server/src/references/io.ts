/**
 * How providers' requests travel: over the network to the museums' fixed API hosts, or from a
 * recording (tests, and `PAVE_SEARCH_FIXTURES` for screenshots and offline demos).
 *
 * A recording is one JSON file: `json` maps each request address to the answer it got, and
 * `images` maps picture addresses to files next to the recording, for the capture service.
 * Asking a recording for an address it does not hold is an error, so a test notices when an
 * adapter starts asking for something new.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ProviderError, type ProviderIO } from './provider'

/** Per request; the search fans out under its own, longer deadline. */
const REQUEST_TIMEOUT_MS = 8_000
const USER_AGENT = 'Pave/0.1 (jewelry design studio)'

/** Real requests. Addresses are built by the adapters from fixed hosts, never taken from users. */
export function networkIO(fetchImpl: typeof fetch = fetch): ProviderIO {
  return {
    async json(url, headers = {}) {
      let res: Response
      try {
        res = await fetchImpl(url, {
          headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          redirect: 'follow',
        })
      } catch (err) {
        const timedOut = (err as Error).name === 'TimeoutError'
        throw new ProviderError(timedOut ? 'took too long to answer' : 'could not be reached')
      }
      if (!res.ok) {
        await res.body?.cancel()
        throw new ProviderError(`answered ${res.status}`, res.status)
      }
      try {
        return await res.json()
      } catch {
        throw new ProviderError('sent an answer that could not be read')
      }
    },
  }
}

export interface Recordings {
  json: Record<string, unknown>
  /** Picture address → file path relative to the recording. */
  images?: Record<string, string>
}

export function recordedIO(recordings: Recordings): ProviderIO {
  return {
    async json(url) {
      if (!(url in recordings.json)) throw new ProviderError(`has no recording for ${url}`)
      const body = recordings.json[url]
      // A recorded failure: { "$status": 503 }.
      const status = (body as { $status?: unknown } | null)?.$status
      if (typeof status === 'number') throw new ProviderError(`answered ${status}`, status)
      return structuredClone(body)
    },
  }
}

/** Reads a recording file (once, at start-up); picture paths are resolved against its folder. */
export function readRecordings(file: string): Recordings {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Recordings
  const base = dirname(file)
  return {
    json: parsed.json ?? {},
    images: Object.fromEntries(
      Object.entries(parsed.images ?? {}).map(([url, path]) => [url, join(base, path)]),
    ),
  }
}
