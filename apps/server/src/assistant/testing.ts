/**
 * Test helpers for the assistant: a model that plays turns given up front or worked out from the
 * request (to use the id of a piece the run just made), and a server with the assistant on it.
 */
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { type ModelStream, type ScriptedTurn, scriptedModel } from '@pave/agent'
import type { KeyCheck } from '@pave/agent/anthropic'
import type { CreateAppOptions } from '../app'
import { type TestServer, testServer } from '../test/harness'
import type { ModelFactory } from './host'
import { type AssistantParts, createAssistant } from './index'

export type TurnFn = (x: {
  n: number
  pieceId: string | null
  params: BetaMessageStreamParams
  signal: AbortSignal | undefined
}) => ScriptedTurn | Promise<ScriptedTurn>

export class TestModel {
  /** Every request, as JSON copies, in order. */
  readonly requests: BetaMessageStreamParams[] = []
  /** The key each run's client was built with. */
  readonly keys: (string | null)[] = []
  readonly queue: (ScriptedTurn | TurnFn)[] = []
  #n = 0

  push(...turns: (ScriptedTurn | TurnFn)[]): this {
    this.queue.push(...turns)
    return this
  }

  readonly factory: ModelFactory = (run) => {
    this.keys.push(run.apiKey)
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
    check?: (key: string) => KeyCheck
  } & Pick<CreateAppOptions, 'config'> = {},
): Promise<AssistantServer> {
  const model = new TestModel()
  const checks: string[] = []
  let parts: AssistantParts | null = null
  const server = await testServer({
    auth: opts.auth,
    config: opts.config,
    services: (runtime) => {
      parts = createAssistant(runtime, {
        env: opts.env ?? {},
        model: model.factory,
        checkKey: async (key) => {
          checks.push(key)
          return opts.check?.(key) ?? { ok: true, models: ['claude-opus-5-5', 'claude-sonnet-5-5'] }
        },
      })
      return parts.services
    },
    routes: (app, _runtime, withCtx) => parts?.routes(app, withCtx),
  })
  return { server, parts: parts!, model, checks }
}

/** Waits until the run's session in this process has ended. */
export async function settled(parts: AssistantParts, runId: string): Promise<void> {
  for (let i = 0; i < 3000 && parts.driver.isLive(runId); i++)
    await new Promise((r) => setTimeout(r, 10))
  if (parts.driver.isLive(runId)) throw new Error(`run ${runId} is still live`)
}
