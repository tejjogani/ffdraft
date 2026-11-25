/**
 * Higgsfield's platform API (a key from Higgsfield's developer cloud). Higgsfield is video-first,
 * but its public API also serves still images; this adapter uses SOUL, its text-to-image model.
 *
 * What its documentation says (read through search; the docs site cannot be opened from this
 * build environment): a request is posted to the model's own path (`higgsfield-ai/soul/standard`)
 * with `Authorization: Key <credential>`, answers with a request id, and is polled at
 * `/requests/<id>/status` until it is `completed` (with `images[].url`), `failed`, `nsfw` or
 * `canceled`. `nsfw` is Higgsfield's own filter and is reported as blocked.
 *
 * Limits here: SOUL takes no reference pictures, so references shape only Claude's enhanced
 * prompt (the result says so); Higgsfield bills in credits and publishes no per-image dollar
 * price that could be checked, so the figure is a rough estimate and marked as one. Animations and
 * on-model video, Higgsfield's main line, are for later.
 */
import type { ImageAspect, ImageQuality } from '@pave/schema'
import {
  errorText,
  type GenerateCall,
  type GeneratedPicture,
  type GenerateResult,
  httpError,
  type ImageProvider,
  type KeyCheckResult,
  ProviderError,
  type ProviderOptions,
  send,
  sleep,
} from './types'

const BASE = 'https://api.higgsfield.ai'
const MODEL = 'higgsfield-ai/soul/standard'
/** A rough per-image figure: Higgsfield's dollar price per credit could not be verified. */
const ROUGH_USD = 0.05
const POLL_MS = 2000
const DEADLINE_MS = 180_000

const ASPECT: Record<ImageAspect, string> = {
  '1:1': '1:1',
  '4:5': '3:4',
  '3:2': '3:2',
  '16:9': '16:9',
}
const RESOLUTION: Record<ImageQuality, string> = { draft: '720p', standard: '720p', high: '1080p' }

type Status = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled' | string

interface StatusBody {
  request_id?: string
  status?: Status
  status_url?: string
  images?: { url?: string }[]
  error?: string
}

export function higgsfieldProvider(opts: ProviderOptions = {}): ImageProvider {
  const f = opts.fetch ?? fetch
  const base = (opts.baseUrl ?? BASE).replace(/\/$/, '')
  const headers = (key: string) => ({ authorization: `Key ${key}`, accept: 'application/json' })

  async function one(
    call: GenerateCall,
    index: number,
  ): Promise<{
    image: GeneratedPicture | null
    blocked: string | null
  }> {
    const res = await send(f, 'Higgsfield', `${base}/${MODEL}`, {
      method: 'POST',
      headers: { ...headers(call.apiKey), 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: call.prompt,
        aspect_ratio: ASPECT[call.aspect],
        resolution: RESOLUTION[call.quality],
        // Claude has already written the prompt; a second rewrite would change what was checked.
        enhance_prompt: false,
        batch_size: 1,
        ...(call.seed !== undefined ? { seed: call.seed + index - 1 } : {}),
      }),
      ...(call.signal ? { signal: call.signal } : {}),
    })
    if (!res.ok) throw httpError('Higgsfield', res, await errorText(res))
    let body = (await res.json()) as StatusBody
    const statusUrl =
      body.status_url ?? (body.request_id ? `${base}/requests/${body.request_id}/status` : null)
    if (!statusUrl) throw new ProviderError('error', 'Higgsfield did not return a request id.')
    const until = Date.now() + DEADLINE_MS
    while (body.status !== 'completed') {
      if (body.status === 'nsfw')
        return { image: null, blocked: 'Higgsfield’s safety filter withheld this image.' }
      if (body.status === 'failed' || body.status === 'canceled')
        throw new ProviderError('error', `Higgsfield could not make the image (${body.status}).`)
      if (Date.now() > until)
        throw new ProviderError('unreachable', 'Higgsfield took too long to make the image.')
      await sleep(POLL_MS, call.signal)
      const poll = await send(f, 'Higgsfield', statusUrl, {
        headers: headers(call.apiKey),
        ...(call.signal ? { signal: call.signal } : {}),
      })
      if (!poll.ok) throw httpError('Higgsfield', poll, await errorText(poll))
      body = (await poll.json()) as StatusBody
    }
    const url = body.images?.[0]?.url
    if (!url) throw new ProviderError('error', 'Higgsfield finished without an image.')
    // The picture is on Higgsfield's own storage; the address came from Higgsfield, not a person.
    const pic = await send(f, 'Higgsfield', url, call.signal ? { signal: call.signal } : {})
    if (!pic.ok) throw httpError('Higgsfield', pic, await errorText(pic))
    const mime = pic.headers.get('content-type')?.split(';')[0] ?? 'image/png'
    return {
      image: { index, bytes: new Uint8Array(await pic.arrayBuffer()), mime, costUsd: ROUGH_USD },
      blocked: null,
    }
  }

  return {
    id: 'higgsfield',
    label: 'Higgsfield',
    keyHelp:
      'Create an API key in Higgsfield’s developer cloud (cloud.higgsfield.ai). Paste the whole credential; for a key id and secret, paste them as id:secret.',
    envNames: ['HIGGSFIELD_API_KEY'],
    models: [{ id: MODEL, label: 'SOUL (text to image)', takesReferences: false }],
    defaultModel: MODEL,
    priceNote:
      'Higgsfield bills in credits; this is a rough estimate per image, not a published dollar price.',
    seconds: 40,
    perImageUsd: () => ROUGH_USD,

    async check(apiKey, o = {}): Promise<KeyCheckResult> {
      // Higgsfield has no free listing call: asking for a request that does not exist tells a
      // rejected key (401/403) from an accepted one (404) without making anything.
      try {
        const res = await send(f, 'Higgsfield', `${base}/requests/pave-key-check/status`, {
          headers: headers(apiKey),
          ...(o.signal ? { signal: o.signal } : {}),
        })
        if (res.ok || res.status === 404 || res.status === 422)
          return { ok: true, message: 'Higgsfield accepted the key.' }
        const e = httpError('Higgsfield', res, await errorText(res))
        return { ok: false, code: e.code === 'blocked' ? 'error' : e.code, message: e.message }
      } catch (err) {
        if (err instanceof ProviderError)
          return {
            ok: false,
            code: err.code === 'blocked' ? 'error' : err.code,
            message: err.message,
          }
        throw err
      }
    },

    async generate(call): Promise<GenerateResult> {
      const results = await Promise.all(
        Array.from({ length: call.count }, (_, i) => one(call, i + 1)),
      )
      const images = results.flatMap((r) => (r.image ? [r.image] : []))
      return {
        model: MODEL,
        images,
        blocked: results.flatMap((r, i) =>
          r.blocked ? [{ index: i + 1, reason: r.blocked }] : [],
        ),
        costUsd: images.length * ROUGH_USD,
        estimated: true,
        notes: call.references.length
          ? [
              'Higgsfield’s SOUL model takes no reference pictures: the references shaped the prompt only.',
            ]
          : [],
      }
    },
  }
}
