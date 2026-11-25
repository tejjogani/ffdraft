/**
 * OpenAI's GPT Image models through the Images API (a key from platform.openai.com).
 *
 * Request shapes follow OpenAI's published OpenAPI description (openai/openai-openapi):
 *  - no references: `POST /v1/images/generations` (JSON) with `model`, `prompt`, `n`, `size`,
 *    `quality`, `moderation`, `output_format`, `background` and `safety_identifier`;
 *  - with references: `POST /v1/images/edits` (multipart) with up to 16 pictures as `image[]`.
 * GPT image models always answer in base64 (`data[].b64_json`) and report token `usage`, from
 * which the cost of each request is worked out.
 *
 * Safety: `moderation` is left at `auto`, OpenAI's stricter setting (the other is `low`), and a
 * hashed `safety_identifier` names the person for OpenAI's abuse monitoring. A request OpenAI's
 * moderation refuses comes back as a 400 whose code is `moderation_blocked`; it is reported as
 * blocked, not as a failure.
 *
 * Prices (USD per million tokens): OpenAI's pricing pages could not be opened from this build
 * environment, so the rates are the ones quoted from them in search results, and the per-image
 * figure uses OpenAI's published output-token counts for a 1024×1024 image (272 low, 1,056
 * medium, 4,160 high). Each real request is costed from its own `usage`.
 */
import type { ImageAspect, ImageQuality } from '@pave/schema'
import {
  errorText,
  firstSentence,
  type GenerateResult,
  httpError,
  type ImageProvider,
  type KeyCheckResult,
  ProviderError,
  type ProviderOptions,
  send,
  unb64,
} from './types'

const BASE = 'https://api.openai.com'

interface OpenAIModel {
  id: string
  label: string
  textIn: number
  imageIn: number
  imageOut: number
  /** Arbitrary WIDTHxHEIGHT sizes (GPT Image 2 and later); otherwise the three standard sizes. */
  freeSizes: boolean
}

export const OPENAI_MODELS: readonly OpenAIModel[] = [
  {
    id: 'gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare',
    textIn: 5,
    imageIn: 8,
    imageOut: 30,
    freeSizes: true,
  },
  {
    id: 'gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst',
    textIn: 5,
    imageIn: 8,
    imageOut: 30,
    freeSizes: true,
  },
  { id: 'gpt-image-2', label: 'GPT Image 2', textIn: 5, imageIn: 8, imageOut: 30, freeSizes: true },
  {
    id: 'gpt-image-1-mini',
    label: 'GPT Image 1 Mini',
    textIn: 2,
    imageIn: 2.5,
    imageOut: 8,
    freeSizes: false,
  },
]

const QUALITY: Record<ImageQuality, 'low' | 'medium' | 'high'> = {
  draft: 'low',
  standard: 'medium',
  high: 'high',
}
const OUT_TOKENS = { low: 272, medium: 1056, high: 4160 } as const

const modelOf = (id: string) => OPENAI_MODELS.find((m) => m.id === id) ?? OPENAI_MODELS[0]!

/** Sizes are multiples of 16 on the newer models; the older ones take 1024², 1024×1536, 1536×1024. */
export function openaiSize(model: string, aspect: ImageAspect): string {
  const free = modelOf(model).freeSizes
  switch (aspect) {
    case '1:1':
      return '1024x1024'
    case '4:5':
      return free ? '1024x1280' : '1024x1536'
    case '3:2':
      return '1536x1024'
    case '16:9':
      return free ? '1536x864' : '1536x1024'
  }
}

interface ImagesResponse {
  data?: { b64_json?: string }[]
  output_format?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    input_tokens_details?: { text_tokens?: number; image_tokens?: number }
  }
}

export function openaiProvider(opts: ProviderOptions = {}): ImageProvider {
  const f = opts.fetch ?? fetch
  const base = (opts.baseUrl ?? BASE).replace(/\/$/, '')
  const perImageUsd = (model: string, quality: ImageQuality) =>
    (OUT_TOKENS[QUALITY[quality]] * modelOf(model).imageOut) / 1e6

  return {
    id: 'openai',
    label: 'OpenAI',
    keyHelp:
      'Create a key at platform.openai.com under API keys. GPT Image models need a verified organisation and billing set up.',
    envNames: ['OPENAI_API_KEY'],
    models: OPENAI_MODELS.map((m) => ({ id: m.id, label: m.label, takesReferences: true })),
    defaultModel: OPENAI_MODELS[0]!.id,
    priceNote:
      'OpenAI’s token rates as quoted from its pricing page; the cost of each request is worked out from the tokens OpenAI reports.',
    seconds: 30,
    perImageUsd,

    async check(apiKey, o = {}): Promise<KeyCheckResult> {
      try {
        const res = await send(f, 'OpenAI', `${base}/v1/models`, {
          headers: { authorization: `Bearer ${apiKey}` },
          ...(o.signal ? { signal: o.signal } : {}),
        })
        if (!res.ok) {
          const e = httpError('OpenAI', res, await errorText(res))
          return { ok: false, code: e.code === 'blocked' ? 'error' : e.code, message: e.message }
        }
        const json = (await res.json()) as { data?: { id?: string }[] }
        const ids = new Set((json.data ?? []).map((m) => m.id))
        const usable = OPENAI_MODELS.filter((m) => ids.has(m.id))
        return {
          ok: true,
          message: usable.length
            ? `The key works. It can use ${usable.map((m) => m.label).join(', ')}.`
            : 'The key works, but OpenAI lists none of Pavé’s image models for it (they need a verified organisation).',
        }
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
      const m = modelOf(call.model)
      const quality = QUALITY[call.quality]
      const size = openaiSize(m.id, call.aspect)
      const auth = { authorization: `Bearer ${call.apiKey}` }
      let res: Response
      if (call.references.length) {
        const form = new FormData()
        form.set('model', m.id)
        form.set('prompt', call.prompt)
        form.set('n', String(call.count))
        form.set('size', size)
        form.set('quality', quality)
        form.set('output_format', 'png')
        form.set('background', 'opaque')
        if (call.safetyId) form.set('safety_identifier', call.safetyId)
        call.references.forEach((r, i) => {
          const ext = r.mime === 'image/jpeg' ? 'jpg' : r.mime === 'image/webp' ? 'webp' : 'png'
          form.append(
            'image[]',
            new Blob([new Uint8Array(r.bytes)], { type: r.mime }),
            `reference-${i + 1}.${ext}`,
          )
        })
        res = await send(f, 'OpenAI', `${base}/v1/images/edits`, {
          method: 'POST',
          headers: auth,
          body: form,
          ...(call.signal ? { signal: call.signal } : {}),
        })
      } else {
        res = await send(f, 'OpenAI', `${base}/v1/images/generations`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: m.id,
            prompt: call.prompt,
            n: call.count,
            size,
            quality,
            moderation: 'auto',
            output_format: 'png',
            background: 'opaque',
            ...(call.safetyId ? { safety_identifier: call.safetyId } : {}),
          }),
          ...(call.signal ? { signal: call.signal } : {}),
        })
      }
      if (!res.ok) {
        const detail = await errorText(res)
        if (res.status === 400 && /moderation_blocked|safety system/i.test(detail))
          return {
            model: m.id,
            images: [],
            blocked: Array.from({ length: call.count }, (_, i) => ({
              index: i + 1,
              reason: `OpenAI’s moderation refused the request (${firstSentence(detail)}).`,
            })),
            costUsd: 0,
            estimated: false,
            notes: [],
          }
        throw httpError('OpenAI', res, detail)
      }
      const json = (await res.json()) as ImagesResponse
      const pictures = (json.data ?? []).flatMap((d) => (d.b64_json ? [d.b64_json] : []))
      const u = json.usage
      const metered = u
        ? ((u.input_tokens_details?.text_tokens ?? u.input_tokens ?? 0) * m.textIn +
            (u.input_tokens_details?.image_tokens ?? 0) * m.imageIn +
            (u.output_tokens ?? 0) * m.imageOut) /
          1e6
        : perImageUsd(m.id, call.quality) * pictures.length
      const each = pictures.length ? metered / pictures.length : 0
      const mime = `image/${json.output_format === 'jpeg' ? 'jpeg' : (json.output_format ?? 'png')}`
      const images = pictures.map((p, i) => ({
        index: i + 1,
        bytes: unb64(p),
        mime,
        costUsd: each,
      }))
      const missing = call.count - images.length
      return {
        model: m.id,
        images,
        blocked: [],
        costUsd: metered,
        estimated: !u,
        notes: missing > 0 ? [`OpenAI returned ${images.length} of ${call.count} images.`] : [],
      }
    },
  }
}
