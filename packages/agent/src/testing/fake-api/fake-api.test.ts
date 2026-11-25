/**
 * The fake Claude API itself: every rule refuses what it should (and the harness's own requests
 * pass), the real SDK streams from it, and each fault reaches the harness as the SDK's own typed
 * error or stop reason. The SDK is pointed at the fake with `baseURL` and a dummy key.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { afterEach, describe, expect, it } from 'vitest'
import {
  anthropicModel,
  buildRequest,
  checkKey,
  classifyStop,
  contextMessage,
  effectiveContent,
  isStreamBreak,
  mapError,
  StreamAdapter,
  toApiMessages,
} from '../../anthropic'
import { buildReadRequest } from '../../photo'
import {
  agentSource,
  DEFAULT_FAKE_KEY,
  type FakeApi,
  type FakeReply,
  Recorder,
  RULES,
  replaySource,
  scriptedSource,
  startFakeApi,
  validateMessages,
} from './index'
import { FAKE_MODELS } from './spec'

const H = { 'x-api-key': DEFAULT_FAKE_KEY, 'anthropic-version': '2026-10-21' }
const withBetas = (b: string[]) => ({ ...H, 'anthropic-beta': b.join(',') })

/** A tiny valid PNG of the given size (header only matters to the fake). */
function png(w: number, h: number): string {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b.toString('base64')
}

/** The harness's own first-turn request for a model, as the loop builds it. */
function harnessBody(model: (typeof FAKE_MODELS)[number], extra: BetaMessageParam[] = []) {
  const req = buildRequest({
    model,
    messages: toApiMessages([
      { role: 'user', content: [{ type: 'text', text: 'A solitaire ring, 1.5 ct oval.' }] },
      contextMessage('Context (the studio when the designer sent the message above).'),
      ...(extra as never[]),
    ]),
  })
  const { betas, ...body } = req as typeof req & { betas?: string[] }
  return { headers: withBetas(betas ?? []), body: { ...body, stream: true } }
}

function rulesOf(headers: Record<string, string>, body: unknown) {
  return validateMessages({ headers, body }, { apiKey: DEFAULT_FAKE_KEY }).map((v) => v.rule)
}

describe('the validator', () => {
  it('cites a document for every rule', () => {
    for (const r of RULES) expect(r.doc).toMatch(/^(skill|live):/)
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length)
  })

  it.each(FAKE_MODELS)('accepts the harness request for %s', (model) => {
    const { headers, body } = harnessBody(model)
    expect(validateMessages({ headers, body }, { apiKey: DEFAULT_FAKE_KEY })).toEqual([])
  })

  it.each(FAKE_MODELS)('accepts the photo read request for %s', (model) => {
    const req = buildReadRequest({
      model,
      images: [{ label: 'front', mediaType: 'image/png', data: png(512, 512) }],
    })
    const { betas, ...body } = req as typeof req & { betas?: string[] }
    expect(rulesOf(withBetas(betas ?? []), { ...body, stream: true })).toEqual([])
  })

  const base = () => harnessBody('claude-opus-5-5')
  const cases: [string, (h: Record<string, string>, b: Record<string, unknown>) => void][] = [
    ['auth.key', (h) => (h['x-api-key'] = 'sk-ant-wrong')],
    ['headers.version', (h) => delete h['anthropic-version']],
    ['headers.beta', (h) => (h['anthropic-beta'] += ',made-up-beta-2026-01-01')],
    ['body.required', (_h, b) => delete b.max_tokens],
    ['model.allowed', (_h, b) => (b.model = 'claude-opus-4-1')],
    ['max_tokens.range', (_h, b) => (b.max_tokens = 200_000)],
    ['sampling.removed', (_h, b) => (b.temperature = 0.5)],
    ['thinking.shape', (_h, b) => (b.thinking = { type: 'enabled', budget_tokens: 4000 })],
    ['thinking.display', (_h, b) => (b.thinking = { type: 'adaptive', display: 'updates' })],
    [
      'thinking.block_binding',
      (h) => (h['anthropic-beta'] = 'server-side-fallback-2026-07-01,compact-2026-01-12'),
    ],
    ['effort.values', (_h, b) => (b.output_config = { effort: 'extreme' })],
    ['tool_choice.forced', (_h, b) => (b.tool_choice = { type: 'any' })],
    [
      'prefill.removed',
      (_h, b) =>
        (b.messages as unknown[]).push({
          role: 'assistant',
          content: [{ type: 'text', text: 'Sure' }],
        }),
    ],
    ['fallbacks.shape', (_h, b) => (b.fallbacks = [{ model: 'claude-haiku-5-5' }])],
    [
      'compaction.beta',
      (h) =>
        (h['anthropic-beta'] =
          'server-side-fallback-2026-07-01,thinking-binding-controls-2026-08-01'),
    ],
    [
      'cache.breakpoints',
      (_h, b) =>
        (b.tools as Record<string, unknown>[])
          .slice(0, 4)
          .forEach((t) => (t.cache_control = { type: 'ephemeral' })),
    ],
    [
      'tools.definition',
      (_h, b) => ((b.tools as Record<string, unknown>[])[0]!.name = 'design.apply'),
    ],
    [
      'tools.eager_input_streaming',
      (_h, b) => ((b.tools as Record<string, unknown>[])[0]!.eager_input_streaming = 'yes'),
    ],
    [
      'strict.schema',
      (_h, b) =>
        (b.tools as Record<string, unknown>[]).push({
          name: 'x_strict',
          description: 'A strict tool.',
          strict: true,
          input_schema: {
            type: 'object',
            properties: { n: { type: 'number', minimum: 0 } },
            required: ['n'],
            additionalProperties: false,
          },
        }),
    ],
    [
      'strict.limits',
      (_h, b) => {
        const props = Object.fromEntries(
          Array.from({ length: 30 }, (_, i) => [`p${i}`, { type: 'string' }]),
        )
        ;(b.tools as unknown[]).push({
          name: 'x_many',
          description: 'Many optional fields.',
          strict: true,
          input_schema: { type: 'object', properties: props, additionalProperties: false },
        })
      },
    ],
    [
      'messages.roles',
      (_h, b) =>
        (b.messages as unknown[]).splice(0, 0, {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
        }),
    ],
    [
      'messages.system_placement',
      (_h, b) =>
        (b.messages as unknown[]).push({
          role: 'system',
          content: [{ type: 'text', text: 'again' }],
        }),
    ],
    [
      'messages.content_types',
      (_h, b) =>
        (b.messages as unknown[]).push({
          role: 'user',
          content: [{ type: 'thinking', thinking: 'x', signature: 'y' }],
        }),
    ],
    [
      'messages.tool_pairing',
      (_h, b) =>
        (b.messages as unknown[]).push(
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'pieces_get', input: {} }],
          },
          { role: 'user', content: [{ type: 'text', text: 'what now?' }] },
        ),
    ],
    [
      'images.limits',
      (_h, b) =>
        (b.messages as unknown[]).push({
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/tiff', data: png(10, 10) },
            },
          ],
        }),
    ],
  ]

  it.each(cases)('refuses a request that breaks %s', (rule, mutate) => {
    const { headers, body } = base()
    const h = { ...headers } as Record<string, string>
    const b = structuredClone(body) as Record<string, unknown>
    mutate(h, b)
    expect(rulesOf(h, b)).toContain(rule)
  })

  it('refuses a system message between tool calls and their results', () => {
    const { headers, body } = harnessBody('claude-opus-5-5', [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'pieces_get', input: {} }],
      },
      { role: 'system', content: [{ type: 'text', text: 'note' }] } as never,
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
    ])
    expect(rulesOf(headers, body)).toEqual(
      expect.arrayContaining(['messages.system_placement', 'messages.tool_pairing']),
    )
  })

  it('refuses text before tool results, and big images in many-image requests', () => {
    const { headers, body } = harnessBody('claude-opus-5-5', [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'pieces_get', input: {} }],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'also' },
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' },
        ],
      },
    ])
    expect(rulesOf(headers, body)).toContain('messages.tool_pairing')
    const many = harnessBody('claude-opus-5-5', [
      { role: 'assistant', content: [{ type: 'text', text: 'Send them.' }] },
      {
        role: 'user',
        content: Array.from({ length: 21 }, () => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: 'image/png' as const,
            data: png(3500, 100),
          },
        })),
      },
    ])
    expect(rulesOf(many.headers, many.body)).toContain('images.limits')
  })

  it('applies the per-model thinking and fallback rules', () => {
    const haiku = harnessBody('claude-haiku-5-5')
    expect(
      rulesOf(haiku.headers, { ...haiku.body, fallbacks: [{ model: 'claude-opus-5' }] }),
    ).toContain('fallbacks.shape')
    const sonnet = harnessBody('claude-sonnet-5-5')
    expect(rulesOf(sonnet.headers, { ...sonnet.body, thinking: { type: 'disabled' } })).toContain(
      'thinking.shape',
    )
    expect(
      rulesOf(sonnet.headers, {
        ...sonnet.body,
        thinking: { type: 'between_tools', display: 'summarized' },
      }),
    ).toContain('thinking.shape')
    const opus = harnessBody('claude-opus-5-5')
    expect(rulesOf(opus.headers, { ...opus.body, thinking: { type: 'between_tools' } })).toContain(
      'thinking.shape',
    )
    expect(rulesOf(haiku.headers, { ...haiku.body, tool_choice: { type: 'any' } })).not.toContain(
      'tool_choice.forced',
    )
  })
})

describe('the fake through the real SDK', () => {
  let api: FakeApi | null = null
  afterEach(async () => {
    await api?.close()
    api = null
  })
  const start = async (replies: FakeReply[]) => {
    api = await startFakeApi({ source: scriptedSource(replies), keepBodies: true, chunk: 7 })
    return api
  }
  const client = (maxRetries = 0) =>
    anthropicModel({ apiKey: DEFAULT_FAKE_KEY, baseURL: api!.url, maxRetries })
  const turn = (
    model: (typeof FAKE_MODELS)[number] = 'claude-opus-5-5',
    more: BetaMessageParam[] = [],
  ) =>
    buildRequest({
      model,
      messages: toApiMessages([
        { role: 'user', content: [{ type: 'text', text: 'Make the band 2.2 mm.' }] },
        contextMessage('Context.'),
        ...(more as never[]),
      ]),
    })

  it('streams thinking, text and a chunked tool call that the SDK reassembles', async () => {
    await start([
      {
        content: [
          { type: 'thinking', thinking: 'The band is a single param.' },
          { type: 'text', text: 'Thinning the band now.' },
          {
            type: 'tool_use',
            name: 'design_apply',
            input: { pieceId: 'pc_x', ops: [{ t: 'set', id: 'band', path: 'width', value: 2.2 }] },
          },
        ],
      },
    ])
    const stream = client().stream(turn(), {})
    const adapter = new StreamAdapter()
    const kinds: string[] = []
    for await (const e of stream) {
      kinds.push(e.type === 'content_block_delta' ? e.delta.type : e.type)
      adapter.push(e)
    }
    const msg = await stream.finalMessage()
    expect(kinds).toEqual(
      expect.arrayContaining([
        'message_start',
        'thinking_delta',
        'signature_delta',
        'text_delta',
        'input_json_delta',
        'message_delta',
        'message_stop',
      ]),
    )
    expect(kinds.filter((k) => k === 'input_json_delta').length).toBeGreaterThan(3)
    expect(adapter.servedBy).toBe('claude-opus-5-5')
    expect(classifyStop(msg)).toMatchObject({ kind: 'tools' })
    const call = msg.content.find((b) => b.type === 'tool_use')
    expect(call && 'input' in call ? call.input : null).toEqual({
      pieceId: 'pc_x',
      ops: [{ t: 'set', id: 'band', path: 'width', value: 2.2 }],
    })
    expect(api!.problems()).toEqual([])
  })

  it('reads the cached prefix back on the next turn of the same conversation', async () => {
    await start([
      { content: [{ type: 'text', text: 'One.' }] },
      { content: [{ type: 'text', text: 'Two.' }] },
    ])
    const first = await client().stream(turn(), {}).finalMessage()
    const replay: BetaMessageParam[] = [
      { role: 'assistant', content: first.content as never },
      { role: 'user', content: [{ type: 'text', text: 'And thinner still.' }] },
    ]
    const second = await client().stream(turn('claude-opus-5-5', replay), {}).finalMessage()
    expect(first.usage.cache_creation_input_tokens).toBeGreaterThan(0)
    expect(second.usage.cache_read_input_tokens).toBeGreaterThanOrEqual(
      first.usage.cache_creation_input_tokens ?? 0,
    )
  })

  it('maps a 401 to provider_auth and a 529 to rate_limited', async () => {
    await start([{ content: [], fault: { type: 'http', status: 529 } }])
    const err = await client()
      .stream(turn(), {})
      .finalMessage()
      .catch((e) => e)
    expect(mapError(err, { model: 'claude-opus-5-5' }).code).toBe('rate_limited')
    const bad = anthropicModel({ apiKey: 'sk-ant-wrong', baseURL: api!.url, maxRetries: 0 })
    const auth = await bad
      .stream(turn(), {})
      .finalMessage()
      .catch((e) => e)
    expect(mapError(auth, { model: 'claude-opus-5-5' }).code).toBe('provider_auth')
  })

  it('lets the SDK retry a 429 after retry-after, then succeed', async () => {
    await start([
      {
        content: [{ type: 'text', text: 'After the wait.' }],
        fault: { type: 'http', status: 429, retryAfter: 0, times: 2 },
      },
    ])
    const msg = await client(2).stream(turn(), {}).finalMessage()
    expect(msg.content[0]).toMatchObject({ type: 'text', text: 'After the wait.' })
    expect(api!.exchanges.filter((e) => e.fault === 'http 429')).toHaveLength(2)
  })

  it('drops the connection mid-stream as a stream break', async () => {
    await start([
      {
        content: [
          { type: 'text', text: 'Half' },
          { type: 'text', text: 'never' },
        ],
        fault: { type: 'drop', afterBlocks: 1 },
      },
    ])
    const err = await client()
      .stream(turn(), {})
      .finalMessage()
      .catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(isStreamBreak(err)).toBe(true)
  })

  it('reports a refusal with stop_details, and a server-side fallback with its block', async () => {
    await start([
      {
        content: [{ type: 'text', text: 'I' }],
        fault: { type: 'refusal', category: 'bio', explanation: 'dual-use' },
      },
      {
        content: [
          { type: 'thinking', thinking: 'declined attempt' },
          { type: 'tool_use', name: 'pieces_get', input: { id: 'pc_x' } },
        ],
        fault: {
          type: 'refusal',
          category: 'cyber',
          fallback: [{ type: 'text', text: 'Here is the answer from the fallback.' }],
        },
      },
    ])
    const refused = await client().stream(turn('claude-haiku-5-5'), {}).finalMessage()
    expect(classifyStop(refused)).toEqual({
      kind: 'refusal',
      category: 'bio',
      explanation: 'dual-use',
    })
    const stream = client().stream(turn(), {})
    const adapter = new StreamAdapter()
    for await (const e of stream) adapter.push(e)
    const rescued = await stream.finalMessage()
    expect(adapter.servedBy).toBe('claude-opus-5')
    const kept = effectiveContent(rescued.content).map((b) => b.type)
    expect(kept).toEqual(['fallback', 'text'])
    expect(classifyStop(rescued)).toEqual({ kind: 'end' })
  })

  it('stops at max_tokens inside a tool call, and pauses a turn', async () => {
    await start([
      {
        content: [
          {
            type: 'tool_use',
            name: 'design_apply',
            input: { pieceId: 'pc_x', ops: [{ t: 'set', id: 'band', path: 'width', value: 2.2 }] },
          },
        ],
        fault: { type: 'max_tokens_in_tool' },
      },
      { content: [{ type: 'text', text: 'Working…' }], fault: { type: 'pause_turn' } },
    ])
    expect(classifyStop(await client().stream(turn(), {}).finalMessage())).toEqual({
      kind: 'max_tokens',
      hasToolCall: true,
    })
    expect(classifyStop(await client().stream(turn(), {}).finalMessage())).toEqual({
      kind: 'continue',
    })
  })

  it('checks a key on the Models API', async () => {
    await start([])
    expect(await checkKey({ apiKey: DEFAULT_FAKE_KEY, baseURL: api!.url })).toEqual({
      ok: true,
      models: [...FAKE_MODELS],
    })
    expect(await checkKey({ apiKey: 'sk-ant-nope', baseURL: api!.url })).toMatchObject({
      ok: false,
      code: 'invalid',
    })
    const url = api!.url
    await api!.close()
    api = null
    expect(await checkKey({ apiKey: DEFAULT_FAKE_KEY, baseURL: url, maxRetries: 0 })).toMatchObject(
      { ok: false, code: 'unreachable' },
    )
  })

  it('binds thinking to the conversation and the model', async () => {
    await start([
      {
        content: [
          { type: 'thinking', thinking: 'plan' },
          { type: 'text', text: 'Done.' },
        ],
      },
      { content: [{ type: 'text', text: 'ok' }] },
      { content: [{ type: 'text', text: 'ok' }] },
    ])
    const first = await client().stream(turn(), {}).finalMessage()
    const next: BetaMessageParam[] = [
      { role: 'assistant', content: first.content as never },
      { role: 'user', content: [{ type: 'text', text: 'Next.' }] },
    ]
    // An edited earlier message breaks the binding: refused without drop_block.
    const edited = turn('claude-opus-5-5', next)
    ;(edited.messages[0]!.content as { text: string }[])[0]!.text = 'Edited history.'
    const err = await client()
      .stream({ ...edited, thinking: { type: 'adaptive', display: 'summarized' } }, {})
      .finalMessage()
      .catch((e) => e)
    expect(mapError(err, { model: 'claude-opus-5-5' }).message).toContain(
      'bound to a different conversation',
    )
    // With drop_block (the harness default) the block is dropped and reported.
    const dropped = client().stream(edited, {})
    const adapter = new StreamAdapter()
    for await (const e of dropped) adapter.push(e)
    await dropped.finalMessage()
    expect(adapter.inputTransformations).toEqual([
      { type: 'thinking_dropped', path: 'messages.2.content.0', reason: 'prefix_binding_mismatch' },
    ])
    // A switch to Haiku cannot read Opus's block: dropped as a model mismatch.
    const switched = client().stream(turn('claude-haiku-5-5', next), {})
    const a2 = new StreamAdapter()
    for await (const e of switched) a2.push(e)
    await switched.finalMessage()
    expect(a2.inputTransformations.map((t) => 'reason' in t && t.reason)).toEqual([
      'model_binding_mismatch',
    ])
  })

  it('holds a structured-output reply to the request schema', async () => {
    await start([{ content: [{ type: 'text', text: '{"kind":"ring"}' }] }])
    const req = buildReadRequest({
      model: 'claude-opus-5-5',
      images: [{ label: 'front', mediaType: 'image/png', data: png(64, 64) }],
    })
    const err = await client()
      .stream(req, {})
      .finalMessage()
      .catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(api!.problems()[0]?.sourceError).toMatch(/does not match the request's schema/)
  })
})

describe('recording and replay', () => {
  it('replays a recording with the live ids swapped in', async () => {
    const rec = new Recorder()
    const recordApi = await startFakeApi({
      source: scriptedSource([
        {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_a',
              name: 'pieces_get',
              input: { id: 'pc_AAAAAAAAAAAAAAAA' },
            },
          ],
        },
        { content: [{ type: 'text', text: 'It is pc_AAAAAAAAAAAAAAAA with node gem_k3f9x2.' }] },
      ]),
      onExchange: (e) => e.reply && e.body && rec.add(e.n!, e.body, e.betas, e.reply),
      keepBodies: true,
    })
    const ask = (pieceId: string, node: string, more: BetaMessageParam[] = []) =>
      buildRequest({
        model: 'claude-opus-5-5',
        messages: toApiMessages([
          { role: 'user', content: [{ type: 'text', text: 'What is this piece?' }] },
          contextMessage(`Open piece: Ring (id ${pieceId}). Nodes: ${node} (gem)`),
          ...(more as never[]),
        ]),
      })
    const run = async (url: string, pieceId: string, node: string) => {
      const c = anthropicModel({ apiKey: DEFAULT_FAKE_KEY, baseURL: url, maxRetries: 0 })
      const m1 = await c.stream(ask(pieceId, node), {}).finalMessage()
      const call = m1.content.find((b) => b.type === 'tool_use') as {
        id: string
        input: { id: string }
      }
      const m2 = await c
        .stream(
          ask(pieceId, node, [
            { role: 'assistant', content: m1.content as never },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: call.id,
                  content: `{"id":"${pieceId}","nodes":["${node}"]}`,
                },
              ],
            },
          ]),
          {},
        )
        .finalMessage()
      return { asked: call.input.id, said: (m2.content[0] as { text: string }).text }
    }
    expect(await run(recordApi.url, 'pc_AAAAAAAAAAAAAAAA', 'gem_k3f9x2')).toEqual({
      asked: 'pc_AAAAAAAAAAAAAAAA',
      said: 'It is pc_AAAAAAAAAAAAAAAA with node gem_k3f9x2.',
    })
    await recordApi.close()
    const recording = rec.recording('unit', 'two turns')
    const source = replaySource(JSON.parse(JSON.stringify(recording)))
    const replayApi = await startFakeApi({ source })
    expect(await run(replayApi.url, 'pc_BBBBBBBBBBBBBBBB', 'gem_zz9y8x')).toEqual({
      asked: 'pc_BBBBBBBBBBBBBBBB',
      said: 'It is pc_BBBBBBBBBBBBBBBB with node gem_zz9y8x.',
    })
    expect(source.report.structural).toEqual([])
    expect(source.report.drift).toEqual([])
    await replayApi.close()
  })

  it('waits for Claude’s reply file in agent mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-agent-'))
    const api = await startFakeApi({ source: agentSource({ dir, pollMs: 20 }) })
    const c = anthropicModel({ apiKey: DEFAULT_FAKE_KEY, baseURL: api.url, maxRetries: 0 })
    const pending = c
      .stream(
        buildRequest({
          model: 'claude-sonnet-5-5',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
        {},
      )
      .finalMessage()
    for (let i = 0; i < 200; i++) {
      try {
        readFileSync(join(dir, 'req-0001.txt'), 'utf8')
        break
      } catch {
        await new Promise((r) => setTimeout(r, 20))
      }
    }
    expect(readFileSync(join(dir, 'req-0001.txt'), 'utf8')).toContain('claude-sonnet-5-5')
    writeFileSync(
      join(dir, 'res-0001.json'),
      JSON.stringify({ content: [{ type: 'text', text: 'Hi from the loop.' }] }),
    )
    const msg = await pending
    expect(msg.content[0]).toMatchObject({ text: 'Hi from the loop.' })
    await api.close()
  })
})
