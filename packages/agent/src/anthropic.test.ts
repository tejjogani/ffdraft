/**
 * The Claude adapter against the real SDK: requests go through `@anthropic-ai/sdk` to an
 * in-memory `fetch`, which answers with SSE built from the same events the scripted model plays,
 * or with the HTTP errors the API returns. No key and no network.
 */
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  MessageCreateParamsBase,
  MessageCreateParamsStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { APIError } from '@anthropic-ai/sdk'
import { ASSISTANT_MODELS, type Message } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import {
  anthropicModel,
  apiTools,
  BETA,
  buildRequest,
  checkKey,
  classifyStop,
  contextMessage,
  EFFORT,
  effectiveContent,
  MAX_TOKENS,
  mapError,
  messageUsage,
  StreamAdapter,
  systemBlocks,
  toApiMessages,
} from './anthropic'
import { eventsFor, messageFor } from './model'
import { SYSTEM_BLOCKS } from './prompt/index'
import { invalidInputResult } from './shape'
import { parseToolCall } from './tools'

const KEY = 'sk-ant-test-0000000000000000000000000000'

// Compile-time proof that the builder's output is a valid streaming request for the SDK.
const typed: MessageCreateParamsStreaming = {
  ...buildRequest({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }] }),
  stream: true,
}
void typed

const sse = (events: readonly unknown[]) =>
  events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('')

interface Seen {
  url: string
  method: string
  headers: Headers
  body: unknown
}

/** An in-memory Claude API: records each request and answers with `reply`. */
function fakeApi(reply: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const s: Seen = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    }
    seen.push(s)
    return reply(s)
  }) as typeof globalThis.fetch
  return { seen, fetch }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const apiError = (status: number, type: string, message: string) =>
  json(status, { type: 'error', error: { type, message } })

const turn = (model: string, content: Parameters<typeof messageFor>[0]['content']) =>
  messageFor({ content, usage: { input_tokens: 1200, output_tokens: 80 } }, 1, model)

describe('buildRequest', () => {
  it('sends the decided shape on every model', () => {
    for (const model of ASSISTANT_MODELS) {
      const r = buildRequest({ model, messages: [{ role: 'user', content: 'A ring' }] })
      expect(r.model).toBe(model)
      expect(r.max_tokens).toBe(MAX_TOKENS)
      expect(r.thinking).toMatchObject({ type: 'adaptive', display: 'summarized' })
      expect(r.output_config).toEqual({ effort: EFFORT })
      expect(r.tool_choice).toEqual({ type: 'auto' })
      expect(r.cache_control).toEqual({ type: 'ephemeral' })
      for (const banned of ['temperature', 'top_p', 'top_k', 'stop_sequences'])
        expect(r, banned).not.toHaveProperty(banned)
      expect(JSON.stringify(r)).not.toContain('budget_tokens')
      // Haiku has no server-side fallback, and Sonnet 5.5's (Claude Sonnet 5) takes no system
      // messages, which every turn carries: the parameter must not be sent on either.
      if (model === 'claude-haiku-5-5' || model === 'claude-sonnet-5-5') {
        expect(r).not.toHaveProperty('fallbacks')
        expect(r.betas).not.toContain(BETA.fallback)
      } else {
        expect(r.fallbacks).toBe('default')
        expect(r.betas).toContain(BETA.fallback)
      }
    }
  })

  it('caches tools and system with one breakpoint on the last system block', () => {
    const sys = systemBlocks()
    expect(sys.map((b) => b.text)).toEqual([...SYSTEM_BLOCKS])
    expect(sys.slice(0, -1).every((b) => b.cache_control === undefined)).toBe(true)
    expect(sys.at(-1)?.cache_control).toEqual({ type: 'ephemeral' })
    for (const t of apiTools()) {
      expect(t.eager_input_streaming).toBe(true)
      expect(t).not.toHaveProperty('cache_control')
    }
  })

  it('can leave out compaction and thinking binding', () => {
    const r = buildRequest({
      model: 'claude-opus-5-5',
      messages: [{ role: 'user', content: 'x' }],
      features: { compaction: false, dropMismatchedThinking: false },
    })
    expect(r).not.toHaveProperty('context_management')
    expect(r.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(r.betas).toEqual([BETA.fallback])
  })

  it('keeps the request prefix byte-identical from turn to turn', () => {
    const history: Pick<Message, 'role' | 'content'>[] = [
      { role: 'user', content: [{ type: 'text', text: 'A 1 ct oval solitaire in rose gold' }] },
      contextMessage(
        'Context (the studio when the designer sent the message above).\nOpen piece: none',
      ),
    ]
    const r1 = buildRequest({ model: 'claude-opus-5-5', messages: toApiMessages(history) })
    const answer = turn('claude-opus-5-5', [
      { type: 'thinking', thinking: 'An oval solitaire; size not given.' },
      { type: 'text', text: 'I will draft the piece.' },
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'pieces_create',
        input: { title: 'Oval solitaire', kind: 'ring' },
      },
    ])
    // Stored as JSON, as the trace store keeps it, then read back.
    const stored = JSON.parse(JSON.stringify(answer.content)) as Record<string, unknown>[]
    history.push(
      { role: 'assistant', content: stored },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: [{ type: 'text', text: '{"id":"pc_1"}' }],
          },
        ],
      },
    )
    const r2 = buildRequest({ model: 'claude-opus-5-5', messages: toApiMessages(history) })
    history.push(
      { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
      { role: 'user', content: [{ type: 'text', text: 'Make the band thinner' }] },
      contextMessage(
        'Context (the studio when the designer sent the message above).\nOpen piece: pc_1',
      ),
    )
    const r3 = buildRequest({ model: 'claude-opus-5-5', messages: toApiMessages(history) })
    const { messages: m1, ...p1 } = r1
    const { messages: m2, ...p2 } = r2
    const { messages: m3, ...p3 } = r3
    // Everything but the messages is the same bytes, and each request's messages start with
    // the previous request's messages, byte for byte (thinking blocks included).
    expect(JSON.stringify(p2)).toBe(JSON.stringify(p1))
    expect(JSON.stringify(p3)).toBe(JSON.stringify(p1))
    expect(JSON.stringify(m2.slice(0, m1.length))).toBe(JSON.stringify(m1))
    expect(JSON.stringify(m3.slice(0, m2.length))).toBe(JSON.stringify(m2))
    const thinking = (m2[2] as { content: { type: string; signature?: string }[] }).content[0]
    expect(thinking).toEqual({
      type: 'thinking',
      thinking: 'An oval solitaire; size not given.',
      signature: 'sig_1_0',
    })
    // Context goes in system messages after the user's turn, never in the top-level system.
    expect((m3.at(-1) as BetaMessageParam).role).toBe('system')
    expect(JSON.stringify(p3.system)).not.toContain('pc_1')
  })
})

describe('through the SDK', () => {
  it('sends the built request and turns the stream into run events and a final message', async () => {
    const message = turn('claude-opus-5-5', [
      { type: 'thinking', thinking: 'Plan: create, then spec.' },
      { type: 'text', text: 'Drafting the ring.' },
      { type: 'tool_use', id: 'toolu_9', name: 'pieces_get', input: { id: 'pc_1' } },
    ])
    const api = fakeApi(
      () =>
        new Response(sse(eventsFor(message)), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    const model = anthropicModel({ apiKey: KEY, fetch: api.fetch, maxRetries: 0 })
    const params = buildRequest({
      model: 'claude-opus-5-5',
      messages: [{ role: 'user', content: 'Hi' }],
    })
    const stream = model.stream(params, {})
    const adapter = new StreamAdapter()
    const events = []
    for await (const e of stream) events.push(...adapter.push(e))
    const final = await stream.finalMessage()

    const [req] = api.seen
    expect(req!.method).toBe('POST')
    expect(new URL(req!.url).pathname).toBe('/v1/messages')
    // The SDK sends the key as a bearer token.
    expect(req!.headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(req!.headers.get('anthropic-beta')?.split(',').sort()).toEqual([...params.betas!].sort())
    const { betas: _betas, ...body } = params
    expect(req!.body).toEqual({ ...body, stream: true })

    expect(events).toEqual([
      { type: 'thinking.delta', index: 0, text: 'Plan: create, then spec.' },
      { type: 'text.delta', index: 1, text: 'Drafting ' },
      { type: 'text.delta', index: 1, text: 'the ring.' },
    ])
    expect(adapter.servedBy).toBe('claude-opus-5-5')
    expect(final.content).toEqual(message.content)
    const stop = classifyStop(final)
    expect(stop.kind).toBe('tools')
    if (stop.kind === 'tools')
      expect(parseToolCall(stop.calls[0]!.name, stop.calls[0]!.input).ok).toBe(true)
    expect(messageUsage(final).tokens).toEqual({
      input: 1200,
      output: 80,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  it('maps the API’s errors to run error codes, without the key in the message', async () => {
    const cases: [Response | Error, string, string][] = [
      [
        apiError(401, 'authentication_error', 'invalid x-api-key'),
        'claude-opus-5-5',
        'provider_auth',
      ],
      [apiError(403, 'permission_error', 'no access'), 'claude-opus-5-5', 'provider_auth'],
      [apiError(429, 'rate_limit_error', 'slow down'), 'claude-opus-5-5', 'rate_limited'],
      [apiError(529, 'overloaded_error', 'overloaded'), 'claude-opus-5-5', 'rate_limited'],
      [
        apiError(404, 'not_found_error', 'model: claude-fable-5-2'),
        'claude-fable-5-2',
        'model_unavailable',
      ],
      [
        apiError(400, 'invalid_request_error', 'retention required'),
        'claude-fable-5-2',
        'model_unavailable',
      ],
      [apiError(400, 'invalid_request_error', 'bad field'), 'claude-sonnet-5-5', 'internal'],
      [apiError(500, 'api_error', 'boom'), 'claude-opus-5-5', 'provider_unreachable'],
      [new TypeError('fetch failed'), 'claude-opus-5-5', 'provider_unreachable'],
    ]
    for (const [reply, m, code] of cases) {
      const api = fakeApi(() => {
        if (reply instanceof Error) throw reply
        return reply.clone()
      })
      const client = anthropicModel({ apiKey: KEY, fetch: api.fetch, maxRetries: 0 })
      const stream = client.stream(
        buildRequest({
          model: m as (typeof ASSISTANT_MODELS)[number],
          messages: [{ role: 'user', content: 'x' }],
        }),
        {},
      )
      const err = await stream.finalMessage().then(
        () => null,
        (e: unknown) => e,
      )
      const mapped = mapError(err, { model: m })
      expect(mapped.code, `${m} ${code}`).toBe(code)
      expect(mapped.message).not.toContain(KEY)
      if (
        code === 'model_unavailable' &&
        m === 'claude-fable-5-2' &&
        reply instanceof Response &&
        reply.status === 400
      )
        expect(mapped.message).toMatch(/retention.*Standard/s)
    }
  })

  it('names retention only as a possible cause of a 400 on Fable, leading with the API’s own words', () => {
    const err = APIError.generate(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'tools.12.input_schema: Schema is too complex for strict mode',
        },
      },
      undefined,
      new Headers(),
    )
    const mapped = mapError(err, { model: 'claude-fable-5-2' })
    expect(mapped.message).toMatch(/^Claude’s API rejected the request for Claude Fable 5\.2: tools\.12/)
    expect(mapped.message).toMatch(/may be/)
    // The raw JSON body never reaches the designer's sentence.
    expect(mapped.message).not.toContain('{')
    const other = mapError(err, { model: 'claude-opus-5-5' })
    expect(other.message).not.toMatch(/retention/)
    expect(other.message).not.toContain('{')
  })

  it('reports a stopped run as interrupted', async () => {
    const message = turn('claude-opus-5-5', [{ type: 'text', text: 'A long answer' }])
    const api = fakeApi(
      () =>
        new Response(sse(eventsFor(message)), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    const controller = new AbortController()
    controller.abort()
    const stream = anthropicModel({ apiKey: KEY, fetch: api.fetch, maxRetries: 0 }).stream(
      buildRequest({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'x' }] }),
      { signal: controller.signal },
    )
    const err = await stream.finalMessage().catch((e: unknown) => e)
    expect(
      mapError(err, { model: 'claude-opus-5-5', aborted: controller.signal.aborted }).code,
    ).toBe('interrupted')
  })
})

describe('checkKey', () => {
  it('lists the tier models a key can use, for free', async () => {
    const api = fakeApi(() =>
      json(200, {
        data: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-4-8'].map(
          (id) => ({
            type: 'model',
            id,
            display_name: id,
            created_at: '2026-01-01T00:00:00Z',
          }),
        ),
        has_more: false,
        first_id: 'claude-opus-5-5',
        last_id: 'claude-opus-4-8',
      }),
    )
    const r = await checkKey({ apiKey: KEY, fetch: api.fetch })
    expect(r).toEqual({
      ok: true,
      models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    })
    expect(new URL(api.seen[0]!.url).pathname).toBe('/v1/models')
    expect(api.seen[0]!.method).toBe('GET')
  })

  it('says in plain words what is wrong', async () => {
    const run = async (reply: () => Response) =>
      checkKey({ apiKey: KEY, fetch: fakeApi(reply).fetch, maxRetries: 0 })
    expect(
      await run(() => apiError(401, 'authentication_error', 'invalid x-api-key')),
    ).toMatchObject({
      ok: false,
      code: 'invalid',
    })
    expect(await run(() => apiError(403, 'permission_error', 'no'))).toMatchObject({
      code: 'forbidden',
    })
    expect(await run(() => apiError(429, 'rate_limit_error', 'no'))).toMatchObject({
      code: 'rate_limited',
    })
    const down = await run(() => {
      throw new TypeError('fetch failed')
    })
    expect(down).toMatchObject({ ok: false, code: 'unreachable' })
    if (!down.ok) expect(down.message).toMatch(/Could not reach Claude’s API/)
  })
})

describe('stop reasons', () => {
  const msg = (stop: BetaMessage['stop_reason'], content: BetaContentBlock[]): BetaMessage =>
    ({ ...turn('claude-opus-5-5', []), stop_reason: stop, content }) as BetaMessage
  const call = {
    type: 'tool_use',
    id: 'toolu_1',
    name: 'pieces_get',
    input: { id: 'pc_1' },
  } as BetaContentBlock

  it('never runs tools on a refusal or a cut-off turn', () => {
    expect(
      classifyStop({
        ...msg('refusal', [call]),
        stop_details: { type: 'refusal', category: 'cyber', explanation: null },
      } as BetaMessage),
    ).toEqual({
      kind: 'refusal',
      category: 'cyber',
      explanation: null,
    })
    expect(classifyStop(msg('max_tokens', [call]))).toEqual({
      kind: 'max_tokens',
      hasToolCall: true,
    })
    expect(classifyStop(msg('pause_turn', [call]))).toEqual({ kind: 'continue' })
    expect(classifyStop(msg('end_turn', []))).toEqual({ kind: 'end' })
    expect(classifyStop(msg('model_context_window_exceeded', []))).toEqual({ kind: 'context_full' })
  })

  it('drops the declined attempt’s thinking and tool calls before a fallback', () => {
    const content = [
      { type: 'thinking', thinking: 'a', signature: 's1' },
      { type: 'text', text: 'Partial ', citations: null },
      { type: 'tool_use', id: 'toolu_x', name: 'pieces_get', input: { id: 'pc_1' } },
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
      { type: 'thinking', thinking: 'b', signature: 's2' },
      { type: 'tool_use', id: 'toolu_y', name: 'pieces_get', input: { id: 'pc_2' } },
    ] as unknown as BetaContentBlock[]
    expect(effectiveContent(content).map((b) => b.type)).toEqual([
      'text',
      'fallback',
      'thinking',
      'tool_use',
    ])
    const stop = classifyStop(msg('tool_use', content))
    expect(stop.kind === 'tools' && stop.calls.map((c) => c.id)).toEqual(['toolu_y'])
  })

  it('answers an unparseable or truncated tool input with an error result, running nothing', () => {
    const parsed = parseToolCall('design_apply', { pieceId: 'pc_1', label: 'Wid' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    const result = invalidInputResult('toolu_1', { pieceId: 'pc_1', label: 'Wid' }, parsed.error)
    expect(result.is_error).toBe(true)
    const text = (result.content as { text: string }[])[0]!.text
    expect(text).toContain('INVALID_INPUT')
    expect(JSON.parse(text.slice(text.indexOf('{'))).INVALID_INPUT).toBe(
      '{"pieceId":"pc_1","label":"Wid"}',
    )
  })
})

// The SDK's beta types are what the request builder is written against.
type _BuilderIsSdkTyped =
  ReturnType<typeof buildRequest> extends MessageCreateParamsBase ? true : never
const _check: _BuilderIsSdkTyped = true
void _check
