/**
 * One shape for every image provider, so the server's pipeline (brief, generate, check, store) is
 * written once. A provider only turns a prompt and reference pictures into images; it never
 * decides what may be generated (Claude's guardrail does that before and after), but it does send
 * its own safety settings at their strictest sensible level and reports what its filter blocked.
 *
 * Every adapter takes `fetch` by injection, so tests replay recorded answers and nothing here
 * reaches the network on its own. Keys are passed per call and never logged or put in an error.
 */
import type { GenerationRole, ImageAspect, ImageProviderId, ImageQuality } from '@pave/schema'

export interface ProviderPicture {
  bytes: Uint8Array
  mime: string
}

/** A board picture sent to the provider with the prompt. */
export interface ProviderReference extends ProviderPicture {
  title: string
  role: GenerationRole | null
}

export interface GenerateCall {
  apiKey: string
  model: string
  /** The enhanced prompt, exactly as shown to the person. */
  prompt: string
  references: readonly ProviderReference[]
  count: number
  aspect: ImageAspect
  quality: ImageQuality
  seed?: number
  /**
   * A stable, opaque id for the person (a hash, never an email), which some providers use for
   * abuse monitoring.
   */
  safetyId?: string
  signal?: AbortSignal
}

export interface GeneratedPicture extends ProviderPicture {
  /** 1-based position among the images asked for. */
  index: number
  /** What this image cost at the provider. */
  costUsd: number
}

export interface GenerateResult {
  /** The model that answered. */
  model: string
  images: GeneratedPicture[]
  /** Images the provider's own safety filter withheld. */
  blocked: { index: number; reason: string }[]
  costUsd: number
  /** True when the cost is a published per-image figure rather than metered from usage. */
  estimated: boolean
  notes: string[]
}

export type KeyCheckCode = 'invalid' | 'forbidden' | 'unreachable' | 'rate_limited' | 'error'

export type KeyCheckResult =
  | { ok: true; message: string }
  | { ok: false; code: KeyCheckCode; message: string }

export interface ImageModelInfo {
  id: string
  label: string
  takesReferences: boolean
}

export interface ProviderOptions {
  fetch?: typeof fetch
  /** Another address for the provider's API (a test server or a gateway). */
  baseUrl?: string
}

export interface ImageProvider {
  readonly id: ImageProviderId
  readonly label: string
  /** Where a person gets a key, in plain words. */
  readonly keyHelp: string
  /** The .env variables a key may come from, first one preferred. */
  readonly envNames: readonly string[]
  readonly models: readonly ImageModelInfo[]
  readonly defaultModel: string
  /** How sure the prices are. */
  readonly priceNote: string
  /** Typical seconds for one request of `count` images. */
  readonly seconds: number
  perImageUsd(model: string, quality: ImageQuality): number
  check(apiKey: string, opts?: { signal?: AbortSignal }): Promise<KeyCheckResult>
  generate(call: GenerateCall): Promise<GenerateResult>
}

/** Why a provider call failed, in words a person can act on. Never carries the key. */
export class ProviderError extends Error {
  constructor(
    readonly code: KeyCheckCode | 'blocked',
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'ProviderError'
  }

  get retryable(): boolean {
    return this.code === 'rate_limited' || this.code === 'unreachable' || (this.status ?? 0) >= 500
  }
}

export const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
export const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

/** A fetch that turns a network failure into a typed, key-free error. */
export async function send(
  f: typeof fetch,
  provider: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await f(url, init)
  } catch (err) {
    if (init.signal?.aborted) throw init.signal.reason
    throw new ProviderError(
      'unreachable',
      `Could not reach ${provider}’s API (${err instanceof Error ? err.message : String(err)}). Check the connection and try again.`,
    )
  }
}

/** The body of an error answer as text, short, for messages (providers never echo the key). */
export async function errorText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 2000)
  } catch {
    return ''
  }
}

/**
 * The common HTTP failures in a person's words. `blocked` is handled by each adapter first,
 * because each provider says it differently.
 */
export function httpError(provider: string, res: Response, detail: string): ProviderError {
  const s = res.status
  if (s === 401 || (s === 400 && /api[_ ]?key/i.test(detail)))
    return new ProviderError('invalid', `${provider} did not accept this API key.`, s)
  if (s === 403)
    return new ProviderError(
      'forbidden',
      `${provider} refused this key for image generation (${firstSentence(detail) || 'permission denied'}).`,
      s,
    )
  if (s === 429)
    return new ProviderError(
      'rate_limited',
      /quota|billing|credit/i.test(detail)
        ? `${provider} says the account is out of quota or credit. Check its billing page.`
        : `${provider} is rate-limiting this key. Wait a minute and try again.`,
      s,
    )
  if (s >= 500)
    return new ProviderError('error', `${provider} had a problem (${s}). Try again shortly.`, s)
  return new ProviderError(
    'error',
    `${provider} could not make the images: ${firstSentence(detail) || `HTTP ${s}`}`,
    s,
  )
}

/** The `message` of a JSON error body, else its first line. */
export function firstSentence(detail: string): string {
  try {
    const j = JSON.parse(detail) as { error?: { message?: string } | string; message?: string }
    const m = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message)
    if (m) return m.slice(0, 300)
  } catch {
    // Not JSON.
  }
  return detail.split('\n')[0]!.slice(0, 300)
}

/** Waits `ms`, or rejects when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
