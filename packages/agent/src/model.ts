/**
 * The seam between the run loop and Claude: `ModelClient.stream` takes the SDK's own request
 * type and yields the SDK's own stream events, then the final message. The real client is in
 * ./anthropic.ts; `scriptedModel` plays back canned turns with exactly the same event shapes,
 * so the loop, the server and the studio are tested end to end without a key or a network.
 */
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaStopReason,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'

export interface ModelStream extends AsyncIterable<BetaRawMessageStreamEvent> {
  /** Resolves once the stream ends; rejects with the error that ended it. */
  finalMessage(): Promise<BetaMessage>
}

export interface ModelClient {
  stream(params: BetaMessageStreamParams, options: { signal?: AbortSignal }): ModelStream
}

// ── Scripted turns ───────────────────────────────────────────────────────────────────────────

export type ScriptedBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; name: string; input: unknown; id?: string }

export interface ScriptedTurn {
  content: ScriptedBlock[]
  /** Defaults to `tool_use` when the turn calls a tool, else `end_turn`. */
  stop_reason?: BetaStopReason
  usage?: Partial<
    Pick<
      BetaUsage,
      'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens'
    >
  >
  model?: string
  /** Throw this instead of answering (an SDK error, to test the error paths). */
  error?: unknown
  /**
   * Throw this after streaming the content, before the stream ends: a connection dropped
   * mid-answer, or a tool input the SDK could not parse.
   */
  failAfterContent?: unknown
}

export interface ScriptedModel extends ModelClient {
  /** Every request received, as JSON-serialised copies, for prefix and shape assertions. */
  readonly requests: BetaMessageStreamParams[]
  /** Turns not played yet. */
  readonly remaining: number
}

/** The SDK's own abort error is thrown by the real client; this stands in for it in scripts. */
export class ScriptAbortError extends Error {
  constructor() {
    super('Request was aborted.')
    this.name = 'AbortError'
  }
}

const usageOf = (u: ScriptedTurn['usage']): BetaUsage =>
  ({
    input_tokens: u?.input_tokens ?? 100,
    output_tokens: u?.output_tokens ?? 50,
    cache_read_input_tokens: u?.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: u?.cache_creation_input_tokens ?? 0,
    cache_creation: null,
    inference_geo: null,
    iterations: null,
    server_tool_use: null,
    service_tier: 'standard',
  }) as unknown as BetaUsage

function blockOf(b: ScriptedBlock, i: number, turn: number): BetaContentBlock {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text, citations: null } as BetaContentBlock
    case 'thinking':
      return {
        type: 'thinking',
        thinking: b.thinking,
        signature: `sig_${turn}_${i}`,
      } as BetaContentBlock
    case 'tool_use':
      return {
        type: 'tool_use',
        id: b.id ?? `toolu_${turn}_${i}`,
        name: b.name,
        input: b.input,
      } as BetaContentBlock
  }
}

/** The events the API streams for a message, in order, as the SDK delivers them. */
export function eventsFor(message: BetaMessage): BetaRawMessageStreamEvent[] {
  const events: BetaRawMessageStreamEvent[] = [
    {
      type: 'message_start',
      message: { ...message, content: [], stop_reason: null, stop_sequence: null },
    } as BetaRawMessageStreamEvent,
  ]
  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { ...block, text: '' },
      } as BetaRawMessageStreamEvent)
      // Two halves, so consumers that join deltas are exercised.
      const mid = Math.ceil(block.text.length / 2)
      for (const text of [block.text.slice(0, mid), block.text.slice(mid)])
        if (text)
          events.push({
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text },
          } as BetaRawMessageStreamEvent)
    } else if (block.type === 'thinking') {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { ...block, thinking: '', signature: '' },
      } as BetaRawMessageStreamEvent)
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: block.thinking },
      } as BetaRawMessageStreamEvent)
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'signature_delta', signature: block.signature },
      } as BetaRawMessageStreamEvent)
    } else if (block.type === 'tool_use') {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { ...block, input: {} },
      } as BetaRawMessageStreamEvent)
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      } as BetaRawMessageStreamEvent)
    } else {
      events.push({
        type: 'content_block_start',
        index,
        content_block: block,
      } as BetaRawMessageStreamEvent)
    }
    events.push({ type: 'content_block_stop', index } as BetaRawMessageStreamEvent)
  })
  events.push({
    type: 'message_delta',
    delta: {
      stop_reason: message.stop_reason,
      stop_sequence: null,
      stop_details: message.stop_details,
    },
    usage: {
      output_tokens: message.usage.output_tokens,
      input_tokens: message.usage.input_tokens,
      cache_read_input_tokens: message.usage.cache_read_input_tokens,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens,
    },
  } as BetaRawMessageStreamEvent)
  events.push({ type: 'message_stop' } as BetaRawMessageStreamEvent)
  return events
}

/** Builds the message a scripted turn stands for. */
export function messageFor(turn: ScriptedTurn, n: number, model: string): BetaMessage {
  const content = turn.content.map((b, i) => blockOf(b, i, n))
  const calls = content.some((b) => b.type === 'tool_use')
  return {
    id: `msg_scripted_${n}`,
    type: 'message',
    role: 'assistant',
    model: turn.model ?? model,
    content,
    stop_reason: turn.stop_reason ?? (calls ? 'tool_use' : 'end_turn'),
    stop_sequence: null,
    stop_details: null,
    usage: usageOf(turn.usage),
    container: null,
    context_management: null,
    diagnostics: null,
  } as unknown as BetaMessage
}

/**
 * A model that answers with the given turns, one per request, in order. Running out of turns
 * is a test failure, reported as an error from the stream. Honours the abort signal between
 * events, as the real stream does.
 */
export function scriptedModel(turns: readonly ScriptedTurn[]): ScriptedModel {
  const queue = [...turns]
  const requests: BetaMessageStreamParams[] = []
  let n = 0
  return {
    requests,
    get remaining() {
      return queue.length
    },
    stream(params, { signal }) {
      requests.push(JSON.parse(JSON.stringify(params)))
      const turn = queue.shift()
      const index = ++n
      let final: Promise<BetaMessage> | null = null
      let settle: { resolve: (m: BetaMessage) => void; reject: (e: unknown) => void } | null = null
      const done = new Promise<BetaMessage>((resolve, reject) => {
        settle = { resolve, reject }
      })
      // A finalMessage() never awaited must not surface as an unhandled rejection.
      done.catch(() => {})
      async function* run(): AsyncGenerator<BetaRawMessageStreamEvent> {
        try {
          if (!turn) throw new Error(`scriptedModel: no turn left for request ${index}`)
          if (turn.error) throw turn.error
          const message = messageFor(turn, index, String(params.model))
          const events = eventsFor(message)
          const cut = turn.failAfterContent ? events.length - 2 : events.length
          for (const event of events.slice(0, cut)) {
            if (signal?.aborted) throw new ScriptAbortError()
            await Promise.resolve()
            yield event
          }
          if (turn.failAfterContent) throw turn.failAfterContent
          settle!.resolve(message)
        } catch (err) {
          settle!.reject(err)
          throw err
        }
      }
      const iterator = run()
      return {
        [Symbol.asyncIterator]: () => iterator,
        finalMessage: () => {
          // Drain the events when the caller did not iterate them.
          final ??= (async () => {
            try {
              for (;;) {
                const r = await iterator.next()
                if (r.done) break
              }
            } catch {
              // The rejection is reported through `done`.
            }
            return done
          })()
          return final
        },
      }
    },
  }
}
