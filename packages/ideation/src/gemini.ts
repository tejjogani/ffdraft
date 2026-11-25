/**
 * Google's Gemini image models through the Gemini API (a key from Google AI Studio).
 *
 * The request shape is the REST form of `generateContent` as the official `@google/genai` SDK
 * (3.6.1) types it: the reference pictures go in as `inlineData` parts before the prompt,
 * `generationConfig.responseModalities: ['IMAGE']` asks for pictures only, and `imageConfig`
 * carries the aspect ratio, the size (`1K`, `2K`, `4K`) and `personGeneration`. One request makes
 * one image, so four images are four requests in parallel.
 *
 * Safety: every harm category the Gemini API accepts is set to `BLOCK_LOW_AND_ABOVE`, its strictest
 * threshold, and people are limited to adults (`ALLOW_ADULT`: a pendant shown worn still works).
 * A picture the filter withholds comes back with a finish reason such as `IMAGE_SAFETY` and is
 * reported as blocked. Pavé's own Claude check runs before and after regardless.
 *
 * Prices (USD): image output is billed per token, 1,120 tokens for a 1K image on the 3.x models.
 * Google's pricing page could not be read from this build environment; the figures come from
 * Google Cloud's model pages and snapshots of the Gemini pricing page, so they are marked as
 * such, and the cost of a real request is metered from its `usageMetadata`.
 */
import type { ImageQuality } from '@pave/schema'
import {
  b64,
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
  unb64,
} from './types'

const BASE = 'https://generativelanguage.googleapis.com'

interface GeminiModel {
  id: string
  label: string
  /** USD per million tokens. */
  textIn: number
  imageOut: number
  /** Output tokens per image at each size the model makes. */
  tokens: Partial<Record<'1K' | '2K' | '4K', number>>
  /** Whether the model takes `imageConfig.imageSize` (2.5 Flash Image does not). */
  sizes: boolean
}

export const GEMINI_MODELS: readonly GeminiModel[] = [
  {
    id: 'gemini-3.1-flash-image',
    label: 'Gemini 3.1 Flash Image',
    textIn: 0.5,
    imageOut: 60,
    tokens: { '1K': 1120, '2K': 1680, '4K': 2520 },
    sizes: true,
  },
  {
    id: 'gemini-3-pro-image',
    label: 'Gemini 3 Pro Image',
    textIn: 2,
    imageOut: 120,
    tokens: { '1K': 1120, '2K': 1120, '4K': 2000 },
    sizes: true,
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'Gemini 2.5 Flash Image',
    textIn: 0.3,
    imageOut: 30,
    tokens: { '1K': 1290 },
    sizes: false,
  },
]

/** draft and standard are the 1K default; high asks for 2K where the model makes it. */
const SIZE: Record<ImageQuality, '1K' | '2K'> = { draft: '1K', standard: '1K', high: '2K' }

/** Every category the Gemini API filters on (the `IMAGE_*` ones are Vertex-only). */
const SAFETY_CATEGORIES = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
] as const

const BLOCKED_FINISH = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
  'RECITATION',
])

const modelOf = (id: string) => GEMINI_MODELS.find((m) => m.id === id) ?? GEMINI_MODELS[0]!

interface Part {
  text?: string
  inlineData?: { mimeType: string; data: string }
  thought?: boolean
}
interface GeminiResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    candidatesTokensDetails?: { modality?: string; tokenCount?: number }[]
  }
  modelVersion?: string
}

export function geminiProvider(opts: ProviderOptions = {}): ImageProvider {
  const f = opts.fetch ?? fetch
  const base = (opts.baseUrl ?? BASE).replace(/\/$/, '')

  const perImageUsd = (model: string, quality: ImageQuality) => {
    const m = modelOf(model)
    const size = m.sizes ? SIZE[quality] : '1K'
    const tokens = m.tokens[size] ?? m.tokens['1K'] ?? 1290
    return (tokens * m.imageOut) / 1e6
  }

  async function one(
    call: GenerateCall,
    index: number,
    people: boolean,
  ): Promise<{
    image: GeneratedPicture | null
    blocked: string | null
    model: string
    peopleRefused: boolean
  }> {
    const m = modelOf(call.model)
    const parts: Part[] = []
    call.references.forEach((r, i) => {
      parts.push({ text: `Reference ${i + 1}${r.role ? ` (${r.role})` : ''}: ${r.title}` })
      parts.push({ inlineData: { mimeType: r.mime, data: b64(r.bytes) } })
    })
    parts.push({ text: call.prompt })
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          // Gemini has no 4:5; 3:4 is the nearest portrait ratio it makes.
          aspectRatio: call.aspect === '4:5' ? '3:4' : call.aspect,
          ...(m.sizes ? { imageSize: SIZE[call.quality] } : {}),
          ...(people ? { personGeneration: 'ALLOW_ADULT' } : {}),
        },
        // A different seed per image, so four requests give four different pictures.
        ...(call.seed !== undefined ? { seed: call.seed + index - 1 } : {}),
      },
      safetySettings: SAFETY_CATEGORIES.map((category) => ({
        category,
        threshold: 'BLOCK_LOW_AND_ABOVE',
      })),
    }
    const res = await send(f, 'Gemini', `${base}/v1beta/models/${m.id}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': call.apiKey },
      body: JSON.stringify(body),
      ...(call.signal ? { signal: call.signal } : {}),
    })
    if (!res.ok) {
      const detail = await errorText(res)
      // An older model that does not take the person setting: the caller asks again without it.
      if (res.status === 400 && /personGeneration/i.test(detail))
        return { image: null, blocked: null, model: m.id, peopleRefused: true }
      throw httpError('Gemini', res, detail)
    }
    const json = (await res.json()) as GeminiResponse
    if (json.promptFeedback?.blockReason)
      return {
        image: null,
        blocked: `Gemini’s safety filter blocked the prompt (${json.promptFeedback.blockReason}).`,
        model: json.modelVersion ?? m.id,
        peopleRefused: false,
      }
    const cand = json.candidates?.[0]
    const picture = cand?.content?.parts?.find((p) => p.inlineData && !p.thought)?.inlineData
    const usage = json.usageMetadata
    const imageTokens =
      usage?.candidatesTokensDetails?.find((d) => d.modality === 'IMAGE')?.tokenCount ??
      usage?.candidatesTokenCount ??
      0
    const cost = usage
      ? ((usage.promptTokenCount ?? 0) * m.textIn + imageTokens * m.imageOut) / 1e6
      : perImageUsd(m.id, call.quality)
    if (!picture) {
      const why = cand?.finishReason ?? 'NO_IMAGE'
      return {
        image: null,
        blocked: BLOCKED_FINISH.has(why)
          ? `Gemini’s safety filter withheld this image (${why}).`
          : `Gemini returned no image (${why}).`,
        model: json.modelVersion ?? m.id,
        peopleRefused: false,
      }
    }
    return {
      image: { index, bytes: unb64(picture.data), mime: picture.mimeType, costUsd: cost },
      blocked: null,
      model: json.modelVersion ?? m.id,
      peopleRefused: false,
    }
  }

  return {
    id: 'gemini',
    label: 'Google Gemini',
    keyHelp:
      'Create a key in Google AI Studio (aistudio.google.com, “Get API key”). Image models need a project with billing turned on.',
    envNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    models: GEMINI_MODELS.map((m) => ({ id: m.id, label: m.label, takesReferences: true })),
    defaultModel: GEMINI_MODELS[0]!.id,
    priceNote:
      'Google’s published token rates for image output (about 1,120 tokens per 1K image); the cost of each request is metered from what Google reports.',
    seconds: 15,
    perImageUsd,

    async check(apiKey, o = {}): Promise<KeyCheckResult> {
      try {
        const res = await send(f, 'Gemini', `${base}/v1beta/models?pageSize=200`, {
          headers: { 'x-goog-api-key': apiKey },
          ...(o.signal ? { signal: o.signal } : {}),
        })
        if (!res.ok) {
          const e = httpError('Gemini', res, await errorText(res))
          return { ok: false, code: e.code === 'blocked' ? 'error' : e.code, message: e.message }
        }
        const json = (await res.json()) as { models?: { name?: string }[] }
        const names = new Set((json.models ?? []).map((m) => m.name?.replace(/^models\//, '')))
        const usable = GEMINI_MODELS.filter((m) => names.has(m.id))
        return {
          ok: true,
          message: usable.length
            ? `The key works. It can use ${usable.map((m) => m.label).join(', ')}.`
            : 'The key works, but Google lists none of Pavé’s image models for it yet; generating may fail until billing is on.',
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
      const notes: string[] = []
      const ask = async (index: number) => {
        let r = await one(call, index, true)
        if (r.peopleRefused) r = await one(call, index, false)
        return r
      }
      const results = await Promise.all(Array.from({ length: call.count }, (_, i) => ask(i + 1)))
      const images = results.flatMap((r) => (r.image ? [r.image] : []))
      const blocked = results.flatMap((r, i) =>
        r.blocked ? [{ index: i + 1, reason: r.blocked }] : [],
      )
      return {
        model: results[0]?.model ?? call.model,
        images,
        blocked,
        costUsd: images.reduce((s, i) => s + i.costUsd, 0),
        estimated: false,
        notes,
      }
    },
  }
}
