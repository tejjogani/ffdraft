/**
 * A quick check of one model's request shape against the live API, for `pnpm agent:smoke --tiers`:
 * the assistant's real request (all tools, the frozen system prompt, context messages, thinking
 * passed back) in three turns, then one photo read (`references.read`'s structured-output call)
 * on a drawn solitaire. It shows what only the live API can: the request is accepted on this
 * model (Haiku without fallbacks, Fable's retention rule), a tool call comes back valid, the
 * second turn reads the cache, no replayed thinking block is dropped, and the read's schema is
 * accepted and its answer validates. Costs a few cents to a few tens of cents per model. The key
 * is passed in and never printed.
 */
import { deflateSync } from 'node:zlib'
import type {
  BetaMessage,
  BetaMessageParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { AssistantModelId } from '@pave/schema'
import {
  anthropicModel,
  buildRequest,
  classifyStop,
  contextMessage,
  mapError,
  messageUsage,
  StreamAdapter,
  toApiMessages,
} from './anthropic'
import { buildReadRequest, parseReadMessage } from './photo'
import { renderContext } from './prompt/index'
import { parseToolCall } from './tools'

const context = () =>
  contextMessage(
    renderContext({
      date: new Date().toISOString().slice(0, 10),
      piece: null,
      selection: [],
      board: null,
      attachments: [],
      references: [],
      designerEdits: [],
      canon: null,
    }),
  )

export interface TierCheckResult {
  model: AssistantModelId
  ok: boolean
  notes: string[]
  costUsd: number
}

async function turn(apiKey: string, model: AssistantModelId, messages: BetaMessageParam[]) {
  const client = anthropicModel({ apiKey, maxRetries: 2 })
  const stream = client.stream(buildRequest({ model, messages }), {})
  const adapter = new StreamAdapter()
  let streamed = 0
  for await (const e of stream) streamed += adapter.push(e).length
  const message: BetaMessage = await stream.finalMessage()
  return { message, adapter, streamed }
}

/** A PNG of RGBA pixels, with no image library: the smoke test runs on the agent package alone. */
function png(rgba: Uint8Array, w: number, h: number): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, 'ascii')
    Buffer.from(data).copy(out, 8)
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(w, 0)
  header.writeUInt32BE(h, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const rows = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++)
    Buffer.from(rgba.subarray(y * w * 4, (y + 1) * w * 4)).copy(rows, y * (w * 4 + 1) + 1)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array()),
  ]).toString('base64')
}

/** A plain drawing of a solitaire from the front: a band, a round stone, four claws. */
function solitaireDrawing(): string {
  const w = 512
  const px = new Uint8Array(w * w * 4).fill(250)
  const put = (x: number, y: number, c: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= w || y >= w) return
    px.set([...c, 255], (y * w + x) * 4)
  }
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const e = ((x - 256) / 150) ** 2 + ((y - 300) / 170) ** 2
      if (e > 0.82 && e < 1) put(x, y, [190, 170, 120])
      if ((x - 256) ** 2 + (y - 140) ** 2 < 48 ** 2) put(x, y, [205, 222, 240])
      for (const [cx, cy] of [
        [214, 104],
        [298, 104],
        [214, 176],
        [298, 176],
      ] as const)
        if ((x - cx) ** 2 + (y - cy) ** 2 < 8 ** 2) put(x, y, [170, 150, 100])
    }
  return png(px, w, w)
}

async function readPhoto(
  apiKey: string,
  model: AssistantModelId,
  r: TierCheckResult,
): Promise<void> {
  const client = anthropicModel({ apiKey, maxRetries: 2 })
  const params = buildReadRequest({
    model,
    images: [{ label: 'drawing.png', mediaType: 'image/png', data: solitaireDrawing() }],
  })
  const message = await client.stream(params, {}).finalMessage()
  r.costUsd += messageUsage(message).costUsd
  try {
    const read = parseReadMessage(message)
    r.notes.push(`photo read: ${read.kind.value}, ${read.archetype.value}, view ${read.view}`)
  } catch (err) {
    r.ok = false
    r.notes.push(`FAIL photo read: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Three turns and a photo read on one model. Never throws: failures are in the result. */
export async function checkTier(apiKey: string, model: AssistantModelId): Promise<TierCheckResult> {
  const r: TierCheckResult = { model, ok: true, notes: [], costUsd: 0 }
  const fail = (why: string) => {
    r.ok = false
    r.notes.push(`FAIL ${why}`)
  }
  const history: { role: 'user' | 'assistant' | 'system'; content: Record<string, unknown>[] }[] =
    []
  const say = (text: string) => {
    history.push({ role: 'user', content: [{ type: 'text', text }] }, context())
  }
  try {
    // 1. A question: the request shape is accepted and streams.
    say('In one sentence: what does a cathedral shoulder do on a solitaire ring?')
    const a = await turn(apiKey, model, toApiMessages(history))
    r.costUsd += messageUsage(a.message).costUsd
    if (classifyStop(a.message).kind !== 'end') fail(`turn 1 stopped with ${a.message.stop_reason}`)
    if (a.streamed === 0) fail('turn 1 streamed no text or thinking')
    history.push({ role: 'assistant', content: JSON.parse(JSON.stringify(a.message.content)) })

    // 2. A tool call: valid input for a real tool, then an error result to recover from.
    say('Read the piece with id pc_smoke using the tool, then tell me its title in one line.')
    const b = await turn(apiKey, model, toApiMessages(history))
    r.costUsd += messageUsage(b.message).costUsd
    const cache = b.message.usage.cache_read_input_tokens ?? 0
    if (cache === 0) fail('turn 2 read nothing from the prompt cache')
    else r.notes.push(`cache read ${cache} tokens`)
    if (b.adapter.inputTransformations.length)
      fail(
        `turn 2: the API changed replayed thinking: ${JSON.stringify(b.adapter.inputTransformations)}`,
      )
    const stop = classifyStop(b.message)
    if (stop.kind !== 'tools') fail(`turn 2 did not call a tool (${b.message.stop_reason})`)
    history.push({ role: 'assistant', content: JSON.parse(JSON.stringify(b.message.content)) })
    if (stop.kind === 'tools') {
      for (const call of stop.calls) {
        const parsed = parseToolCall(call.name, call.input)
        if (!parsed.ok) fail(`tool input did not validate: ${parsed.error}`)
        else r.notes.push(`called ${call.name}`)
      }
      history.push({
        role: 'user',
        content: stop.calls.map((c) => ({
          type: 'tool_result',
          tool_use_id: c.id,
          is_error: true,
          content: [{ type: 'text', text: 'Not found: there is no piece pc_smoke.' }],
        })),
      })
      // 3. The answer after a tool result, with every earlier thinking block passed back.
      const c = await turn(apiKey, model, toApiMessages(history))
      r.costUsd += messageUsage(c.message).costUsd
      if (c.adapter.inputTransformations.length)
        fail(
          `turn 3: the API changed replayed thinking: ${JSON.stringify(c.adapter.inputTransformations)}`,
        )
      if (classifyStop(c.message).kind !== 'end')
        fail(`turn 3 stopped with ${c.message.stop_reason}`)
    }
    // 4. A photo read: structured output with the read's schema, on the same model.
    await readPhoto(apiKey, model, r)
  } catch (err) {
    fail(mapError(err, { model }).message)
  }
  return r
}
