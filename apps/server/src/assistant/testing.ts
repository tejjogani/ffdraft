/**
 * Test helpers for the assistant: a model that plays turns given up front or worked out from the
 * request (to use the id of a piece the run just made), and a server with the assistant on it.
 *
 * By default every turn travels the real way: the run's client is the real SDK client
 * (`anthropicModel`), pointed at the strict fake Claude API (@pave/agent/testing/fake-api), which
 * validates each request as the real API would and streams the turn back as SSE. So every
 * assistant test also proves the harness never sends a request the API would refuse; a refused
 * request fails the test with the rule it broke. `PAVE_TEST_TRANSPORT=direct` (or
 * `new TestModel({ transport: 'direct' })`) plays turns in-process instead, without the SDK.
 */
import { APIConnectionError, APIError } from '@anthropic-ai/sdk'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { type ModelClient, type ModelStream, type ScriptedTurn, scriptedModel } from '@pave/agent'
import { anthropicModel, type KeyCheck } from '@pave/agent/anthropic'
import {
  type FakeApi,
  type FakeReply,
  type ReplyBlock,
  type ReplySource,
  startFakeApi,
} from '@pave/agent/testing/fake-api'
import type { CreateAppOptions } from '../app'
import { createEngines } from '../engines'
import { createImageGen, type ImageGenOptions } from '../imagegen'
import type { Services } from '../services'
import { type TestServer, testServer } from '../test/harness'
import type { ModelFactory } from './host'
import { type AssistantParts, createAssistant } from './index'

export type TurnFn = (x: {
  n: number
  pieceId: string | null
  params: BetaMessageStreamParams
  signal: AbortSignal | undefined
}) => ScriptedTurn | Promise<ScriptedTurn>

/** Header that tells the fake which run a request belongs to (the fake ignores it otherwise). */
const RUN_HEADER = 'x-pave-test-run'

/** A scripted turn as the fake API serves it: same content, same usage, faults for errors. */
export function replyOf(turn: ScriptedTurn): FakeReply {
  const content = turn.content as ReplyBlock[]
  const hasTool = content.some((b) => b.type === 'tool_use')
  const u = turn.usage
  const reply: FakeReply = {
    content,
    // The usage the in-process model reports, so costs stay what the tests expect.
    usage: {
      input_tokens: u?.input_tokens ?? 100,
      output_tokens: u?.output_tokens ?? 50,
      cache_read_input_tokens: u?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: u?.cache_creation_input_tokens ?? 0,
    },
    ...(turn.model ? { servedBy: turn.model } : {}),
  }
  const stop = turn.stop_reason
  if (stop === 'max_tokens') {
    if (hasTool) reply.fault = { type: 'max_tokens_in_tool' }
    else reply.stop_reason = 'max_tokens'
  } else if (stop === 'pause_turn') reply.fault = { type: 'pause_turn' }
  // A safety refusal as the API sends it: stop_details with a category, no server-side fallback.
  else if (stop === 'refusal') reply.fault = { type: 'refusal', category: 'cyber' }
  else if (stop && stop !== 'tool_use' && stop !== 'end_turn') reply.stop_reason = stop
  else if (stop === 'end_turn' && hasTool) reply.stop_reason = 'end_turn'
  if (turn.error instanceof APIConnectionError) reply.fault = { type: 'reset' }
  else if (turn.error instanceof APIError && turn.error.status)
    reply.fault = {
      type: 'http',
      status: turn.error.status as 400,
      message:
        (turn.error.error as { error?: { message?: string } } | undefined)?.error?.message ??
        turn.error.message,
    }
  else if (turn.error)
    throw new Error('TestModel: over the fake API a turn can fail only with an SDK error')
  if (turn.failAfterContent) reply.fault = { type: 'drop', afterBlocks: content.length }
  if (turn.stallAfterContent) reply.fault = { type: 'stall', afterBlocks: content.length }
  return reply
}

export class TestModel {
  /** Every request, as JSON copies, in order. */
  readonly requests: BetaMessageStreamParams[] = []
  /** The key each run's client was built with. */
  readonly keys: (string | null)[] = []
  readonly queue: (ScriptedTurn | TurnFn)[] = []
  readonly transport: 'fake' | 'direct'
  /** The fake Claude API the runs talk to through the real SDK (after `start`). */
  api: FakeApi | null = null
  #n = 0
  readonly #runs = new Map<string, Parameters<ModelFactory>[0]>()

  constructor(opts: { transport?: 'fake' | 'direct' } = {}) {
    this.transport =
      opts.transport ?? (process.env.PAVE_TEST_TRANSPORT === 'direct' ? 'direct' : 'fake')
  }

  push(...turns: (ScriptedTurn | TurnFn)[]): this {
    this.queue.push(...turns)
    return this
  }

  /**
   * Starts the fake API (no-op for the direct transport). `source` replaces the queue of turns:
   * a recording replayed through the real loop, for example.
   */
  async start(opts: { source?: ReplySource } = {}): Promise<this> {
    if (this.transport !== 'fake' || this.api) return this
    this.api = await startFakeApi({
      // A refused request fails the run; say why where the test output shows it.
      onExchange: (e) => {
        if (e.violation)
          console.error(
            `fake Claude API refused a request (${e.violation.rule}): ${e.violation.message}`,
          )
        if (e.sourceError) console.error(`fake Claude API could not serve a turn: ${e.sourceError}`)
      },
      source: opts.source ?? {
        next: async (req) => {
          const run = this.#runs.get(req.headers[RUN_HEADER] ?? '')
          const n = ++this.#n
          if (process.env.PAVE_TEST_DEBUG)
            console.log(
              `fake request ${n} from ${req.headers[RUN_HEADER]} (${this.queue.length} queued)`,
            )
          const next = this.queue.shift()
          const turn =
            typeof next === 'function'
              ? await next({
                  n,
                  pieceId: run?.pieceId() ?? null,
                  params: req.body as unknown as BetaMessageStreamParams,
                  signal: req.signal,
                })
              : next
          if (!turn) throw new Error(`TestModel: no turn left for request ${n}`)
          return replyOf({
            ...turn,
            content: turn.content.map((b, i) =>
              b.type === 'tool_use' && !b.id ? { ...b, id: `toolu_t${n}_${i}` } : b,
            ),
          })
        },
      },
    })
    return this
  }

  async close(): Promise<void> {
    await this.api?.close()
    this.api = null
  }

  /** Requests the fake API refused, or turns it could not serve: a test expects none. */
  problems(): string[] {
    return (this.api?.problems() ?? []).map((e) =>
      e.violation
        ? `request refused (${e.violation.rule}): ${e.violation.message}`
        : `turn not served: ${e.sourceError}`,
    )
  }

  readonly factory: ModelFactory = (run) => {
    this.keys.push(run.apiKey)
    if (this.transport === 'fake') return this.#fakeClient(run)
    return {
      stream: (params, { signal }): ModelStream => {
        this.requests.push(JSON.parse(JSON.stringify(params)))
        const n = ++this.#n
        const next = this.queue.shift()
        const inner = (async () => {
          const turn =
            typeof next === 'function'
              ? await next({ n, pieceId: run.pieceId(), params, signal })
              : next
          const withIds = turn && {
            ...turn,
            content: turn.content.map((b, i) =>
              b.type === 'tool_use' && !b.id ? { ...b, id: `toolu_t${n}_${i}` } : b,
            ),
          }
          return scriptedModel(withIds ? [withIds] : []).stream(params, { signal })
        })()
        // Settled through the stream; never an unhandled rejection on its own.
        inner.catch(() => {})
        async function* events() {
          yield* await inner
        }
        const it = events()
        return {
          [Symbol.asyncIterator]: () => it,
          finalMessage: async () => (await inner).finalMessage(),
        }
      },
    }
  }

  #fakeClient(run: Parameters<ModelFactory>[0]): ModelClient {
    const api = this.api
    if (!api) throw new Error('TestModel: call start() before runs use the fake API')
    this.#runs.set(run.runId, run)
    const client = anthropicModel({
      apiKey: api.apiKey,
      baseURL: api.url,
      // Errors reach the run as the turn says; the SDK's retries are tested with the fake itself.
      maxRetries: 0,
      fetch: (url, init) => {
        const headers = new Headers(init?.headers)
        headers.set(RUN_HEADER, run.runId)
        return fetch(url, { ...init, headers })
      },
    })
    return {
      stream: (params, options) => {
        this.requests.push(JSON.parse(JSON.stringify(params)))
        return client.stream(params, options)
      },
    }
  }
}

export const tool = (name: string, input: unknown, id?: string): ScriptedTurn['content'][number] =>
  id ? { type: 'tool_use', name, input, id } : { type: 'tool_use', name, input }
export const text = (t: string): ScriptedTurn['content'][number] => ({ type: 'text', text: t })

export interface AssistantServer {
  server: TestServer
  parts: AssistantParts
  model: TestModel
  checks: string[]
}

/** A test server with the assistant on, driven by a {@link TestModel}. */
export async function assistantServer(
  opts: {
    env?: Record<string, string | undefined>
    auth?: 'local' | 'accounts'
    check?: (key: string) => KeyCheck | Promise<KeyCheck>
    /** Where the fake API's answers come from (default: the test model's queue of turns). */
    source?: ReplySource
    /** Also run the real engines (kernel workers): captures and fits that need geometry. */
    engines?: boolean
    /** More engines to register (search, capture, …). */
    services?: Partial<Services>
    /** Image generation: its env (keys, PAVE_IMAGE_GEN=fake) and replacement providers. */
    images?: ImageGenOptions
  } & Pick<CreateAppOptions, 'config'> = {},
): Promise<AssistantServer> {
  const model = await new TestModel().start({ source: opts.source })
  const checks: string[] = []
  let parts: AssistantParts | null = null
  const server = await testServer({
    auth: opts.auth,
    config: opts.config,
    services: (runtime) => {
      parts = createAssistant(runtime, {
        // PAVE_TEST_MODEL points the Standard tier (the default) at another model, so a whole
        // test file can run on each tier's model (scripts/test-tiers.sh).
        env: {
          ...(process.env.PAVE_TEST_MODEL
            ? { PAVE_ASSISTANT_MODEL_STANDARD: process.env.PAVE_TEST_MODEL }
            : {}),
          ...opts.env,
        },
        model: model.factory,
        checkKey: async (key) => {
          checks.push(key)
          return (
            (await opts.check?.(key)) ?? {
              ok: true,
              models: ['claude-opus-5-5', 'claude-sonnet-5-5'],
            }
          )
        },
      })
      const images = opts.images ? createImageGen(runtime, opts.images).services : {}
      if (!opts.engines) return { ...opts.services, ...parts.services, ...images }
      return {
        ...createEngines(runtime, { engineFile: null, pool: { size: 2 } }),
        ...opts.services,
        ...parts.services,
        ...images,
      }
    },
    routes: (app, _runtime, withCtx) => parts?.routes(app, withCtx),
  })
  const dispose = server.dispose
  server.dispose = async () => {
    await dispose()
    await model.close()
  }
  return { server, parts: parts!, model, checks }
}

/** Waits until the run's session in this process has ended. */
export async function settled(
  parts: AssistantParts,
  runId: string,
  timeoutMs = 30_000,
): Promise<void> {
  for (let i = 0; i < timeoutMs / 10 && parts.driver.isLive(runId); i++)
    await new Promise((r) => setTimeout(r, 10))
  if (parts.driver.isLive(runId)) throw new Error(`run ${runId} is still live`)
}
