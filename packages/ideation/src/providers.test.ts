import { describe, expect, it } from 'vitest'
import {
  encodePng,
  fakeProvider,
  geminiProvider,
  higgsfieldProvider,
  openaiProvider,
  openaiSize,
  ProviderError,
  ringPng,
} from './index'
import type { GenerateCall } from './types'

/**
 * Recorded answers are written from each provider's documented response shapes (the Gemini SDK's
 * types, OpenAI's OpenAPI description, Higgsfield's docs as quoted), since no live answer could
 * be recorded for Gemini or Higgsfield here. The live OpenAI answer is in live.test.ts's notes.
 */
const KEY = 'test-key-0123456789'
const png = ringPng(32, 40)
const pngB64 = Buffer.from(png).toString('base64')

interface Seen {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

function fakeFetch(answer: (req: Seen, n: number) => Response | Promise<Response>) {
  const seen: Seen[] = []
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v
    })
    let body: unknown = init.body
    if (typeof init.body === 'string') body = JSON.parse(init.body)
    const req = { url: String(input), method: init.method ?? 'GET', headers, body }
    seen.push(req)
    return answer(req, seen.length)
  }) as typeof fetch
  return { f, seen }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const call = (over: Partial<GenerateCall> = {}): GenerateCall => ({
  apiKey: KEY,
  model: '',
  prompt: 'A gold pendant, front view, on a plain white background',
  references: [],
  count: 4,
  aspect: '1:1',
  quality: 'draft',
  ...over,
})

describe('gemini', () => {
  const okAnswer = () =>
    json(200, {
      candidates: [
        {
          content: { parts: [{ inlineData: { mimeType: 'image/png', data: pngB64 } }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 300,
        candidatesTokenCount: 1120,
        candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }],
      },
      modelVersion: 'gemini-3.1-flash-image',
    })

  it('sends references first, the strictest safety settings, and one request per image', async () => {
    const { f, seen } = fakeFetch(okAnswer)
    const p = geminiProvider({ fetch: f })
    const r = await p.generate(
      call({
        model: 'gemini-3.1-flash-image',
        references: [{ bytes: png, mime: 'image/png', title: 'The trophy', role: 'subject' }],
      }),
    )
    expect(seen).toHaveLength(4)
    const req = seen[0]!
    expect(req.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
    )
    expect(req.headers['x-goog-api-key']).toBe(KEY)
    const body = req.body as {
      contents: { parts: { text?: string; inlineData?: unknown }[] }[]
      generationConfig: { responseModalities: string[]; imageConfig: Record<string, string> }
      safetySettings: { category: string; threshold: string }[]
    }
    const parts = body.contents[0]!.parts
    expect(parts[0]!.text).toBe('Reference 1 (subject): The trophy')
    expect(parts[1]!.inlineData).toEqual({ mimeType: 'image/png', data: pngB64 })
    expect(parts.at(-1)!.text).toContain('gold pendant')
    expect(body.generationConfig.responseModalities).toEqual(['IMAGE'])
    expect(body.generationConfig.imageConfig).toEqual({
      aspectRatio: '1:1',
      imageSize: '1K',
      personGeneration: 'ALLOW_ADULT',
    })
    expect(body.safetySettings).toHaveLength(4)
    expect(body.safetySettings.every((s) => s.threshold === 'BLOCK_LOW_AND_ABOVE')).toBe(true)
    expect(r.images).toHaveLength(4)
    expect(r.images[0]!.bytes).toEqual(png)
    // Metered from usage: 300 prompt tokens at $0.50/M plus 1,120 image tokens at $60/M.
    expect(r.images[0]!.costUsd).toBeCloseTo((300 * 0.5 + 1120 * 60) / 1e6, 8)
    expect(r.estimated).toBe(false)
  })

  it('reports an image its filter withheld as blocked, and keeps the others', async () => {
    const { f } = fakeFetch((_, n) =>
      n === 2
        ? json(200, { candidates: [{ content: { parts: [] }, finishReason: 'IMAGE_SAFETY' }] })
        : okAnswer(),
    )
    const r = await geminiProvider({ fetch: f }).generate(call({ model: 'gemini-3.1-flash-image' }))
    expect(r.images.map((i) => i.index)).toEqual([1, 3, 4])
    expect(r.blocked).toEqual([{ index: 2, reason: expect.stringContaining('IMAGE_SAFETY') }])
  })

  it('asks again without the person setting when a model does not take it', async () => {
    const { f, seen } = fakeFetch((req) =>
      (req.body as { generationConfig: { imageConfig: object } }).generationConfig.imageConfig &&
      'personGeneration' in
        (req.body as { generationConfig: { imageConfig: object } }).generationConfig.imageConfig
        ? json(400, {
            error: { message: 'personGeneration is not supported', status: 'INVALID_ARGUMENT' },
          })
        : okAnswer(),
    )
    const r = await geminiProvider({ fetch: f }).generate(
      call({ model: 'gemini-2.5-flash-image', count: 1 }),
    )
    expect(seen).toHaveLength(2)
    expect(r.images).toHaveLength(1)
    // 2.5 Flash Image takes no size.
    expect(
      (seen[1]!.body as { generationConfig: { imageConfig: object } }).generationConfig.imageConfig,
    ).toEqual({
      aspectRatio: '1:1',
    })
  })

  it('maps a rejected key to plain words without the key', async () => {
    const { f } = fakeFetch(() =>
      json(400, {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
        },
      }),
    )
    const p = geminiProvider({ fetch: f })
    const check = await p.check(KEY)
    expect(check).toEqual({
      ok: false,
      code: 'invalid',
      message: 'Gemini did not accept this API key.',
    })
    const err = await p.generate(call({ count: 1 })).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(String(err.message)).not.toContain(KEY)
  })

  it('checks a key with the free model list', async () => {
    const { f, seen } = fakeFetch(() =>
      json(200, {
        models: [{ name: 'models/gemini-3.1-flash-image' }, { name: 'models/gemini-2.5-flash' }],
      }),
    )
    const r = await geminiProvider({ fetch: f }).check(KEY)
    expect(seen[0]!.url).toContain('/v1beta/models')
    expect(r).toEqual({ ok: true, message: 'The key works. It can use Gemini 3.1 Flash Image.' })
  })
})

describe('openai', () => {
  const okAnswer = (n: number) =>
    json(200, {
      created: 1,
      data: Array.from({ length: n }, () => ({ b64_json: pngB64 })),
      output_format: 'png',
      size: '1024x1024',
      quality: 'low',
      usage: {
        total_tokens: 1300,
        input_tokens: 212,
        output_tokens: 1088,
        input_tokens_details: { text_tokens: 212, image_tokens: 0 },
      },
    })

  it('generates four with moderation at auto and a hashed safety id', async () => {
    const { f, seen } = fakeFetch(() => okAnswer(4))
    const r = await openaiProvider({ fetch: f }).generate(
      call({ model: 'gpt-image-2.5-flare', safetyId: 'u_hash' }),
    )
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/images/generations')
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(seen[0]!.body).toEqual({
      model: 'gpt-image-2.5-flare',
      prompt: expect.stringContaining('gold pendant'),
      n: 4,
      size: '1024x1024',
      quality: 'low',
      moderation: 'auto',
      output_format: 'png',
      background: 'opaque',
      safety_identifier: 'u_hash',
    })
    expect(r.images).toHaveLength(4)
    // 212 text tokens at $5/M and 1,088 image tokens at $30/M, shared over four images.
    expect(r.costUsd).toBeCloseTo((212 * 5 + 1088 * 30) / 1e6, 8)
    expect(r.images[0]!.costUsd).toBeCloseTo(r.costUsd / 4, 8)
  })

  it('sends references to the edits endpoint as image[] parts', async () => {
    const { f, seen } = fakeFetch(() => okAnswer(2))
    await openaiProvider({ fetch: f }).generate(
      call({
        model: 'gpt-image-2.5-flare',
        count: 2,
        aspect: '4:5',
        references: [
          { bytes: png, mime: 'image/png', title: 'Trophy', role: 'subject' },
          { bytes: png, mime: 'image/jpeg', title: 'Pendant', role: 'style' },
        ],
      }),
    )
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/images/edits')
    const form = seen[0]!.body as FormData
    expect(form.getAll('image[]')).toHaveLength(2)
    expect(form.get('size')).toBe('1024x1280')
    expect(form.get('n')).toBe('2')
  })

  it('treats moderation_blocked as blocked, not as a failure', async () => {
    const { f } = fakeFetch(() =>
      json(400, {
        error: {
          code: 'moderation_blocked',
          message: 'Your request was rejected by the safety system.',
          type: 'image_generation_user_error',
        },
      }),
    )
    const r = await openaiProvider({ fetch: f }).generate(call({ count: 2 }))
    expect(r.images).toEqual([])
    expect(r.blocked.map((b) => b.index)).toEqual([1, 2])
    expect(r.costUsd).toBe(0)
  })

  it('maps 401 and 403 to plain words', async () => {
    let status = 401
    const { f } = fakeFetch(() =>
      json(status, {
        error: {
          message:
            status === 401
              ? 'Incorrect API key provided: tes***789.'
              : 'Your organization must be verified to use the model `gpt-image-2.5-flare`.',
        },
      }),
    )
    const p = openaiProvider({ fetch: f })
    expect(await p.check(KEY)).toMatchObject({ ok: false, code: 'invalid' })
    status = 403
    const e = await p.generate(call({ count: 1 })).catch((x) => x)
    expect(e.code).toBe('forbidden')
    expect(e.message).toContain('must be verified')
  })

  it('uses only standard sizes on the older models', () => {
    expect(openaiSize('gpt-image-1-mini', '16:9')).toBe('1536x1024')
    expect(openaiSize('gpt-image-2.5-flare', '16:9')).toBe('1536x864')
  })
})

describe('higgsfield', () => {
  it('submits, polls until completed, and fetches the picture', async () => {
    const { f, seen } = fakeFetch((req) => {
      if (req.method === 'POST') return json(200, { request_id: 'r1', status: 'queued' })
      if (req.url.endsWith('/requests/r1/status'))
        return json(200, { status: 'completed', images: [{ url: 'https://cdn.example/r1.png' }] })
      return new Response(png, { headers: { 'content-type': 'image/png' } })
    })
    const r = await higgsfieldProvider({ fetch: f }).generate(
      call({
        model: 'higgsfield-ai/soul/standard',
        count: 1,
        references: [{ bytes: png, mime: 'image/png', title: 'x', role: null }],
      }),
    )
    expect(seen[0]!.url).toBe('https://api.higgsfield.ai/higgsfield-ai/soul/standard')
    expect(seen[0]!.headers.authorization).toBe(`Key ${KEY}`)
    expect(seen[0]!.body).toMatchObject({
      enhance_prompt: false,
      batch_size: 1,
      aspect_ratio: '1:1',
    })
    expect(r.images[0]!.bytes).toEqual(png)
    expect(r.estimated).toBe(true)
    expect(r.notes[0]).toContain('takes no reference pictures')
  }, 10_000)

  it('reports nsfw as blocked', async () => {
    const { f } = fakeFetch(() => json(200, { request_id: 'r2', status: 'nsfw' }))
    const r = await higgsfieldProvider({ fetch: f }).generate(call({ count: 1 }))
    expect(r.images).toEqual([])
    expect(r.blocked).toHaveLength(1)
  })
})

describe('fake', () => {
  it('draws distinct, decodable pictures and follows its markers', async () => {
    const p = fakeProvider({ size: 64 })
    const r = await p.generate(call({ model: 'fake-image-1', prompt: 'a ring [fake:block 3]' }))
    expect(r.images.map((i) => i.index)).toEqual([1, 2, 4])
    expect(r.blocked[0]!.index).toBe(3)
    expect([...r.images[0]!.bytes.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47])
    expect(r.images[0]!.bytes).not.toEqual(r.images[1]!.bytes)
    expect(p.calls).toHaveLength(1)
    await expect(p.generate(call({ prompt: '[fake:fail]' }))).rejects.toThrow('told to fail')
    expect(encodePng(new Uint8Array(4), 1, 1).length).toBeGreaterThan(40)
  })
})
