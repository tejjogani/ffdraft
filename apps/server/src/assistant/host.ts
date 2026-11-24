/**
 * What one session of a run works with: the run's context (built once, as its user, acting as
 * the run), the model client for the run's tier, the abort signal and the event channel. Each
 * tool call runs as `{ ...ctx, actor: { …agent, toolCallId } }`, so every change, asset and usage
 * row it makes is attributed to the run and the call, with exactly the user's rights.
 */
import type { ModelClient } from '@pave/agent'
import type { RequestFeatures, RunEventBody } from '@pave/agent/anthropic'
import type { Actor } from '@pave/schema'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { notFound } from '../errors'
import type { Runtime } from '../runtime'
import type { ClientBridge } from './bridge'
import type { Driver } from './driver'
import type { KeyStore } from './keys'

/** Builds the model client for one run. The key is null only in scripted (test) mode. */
export type ModelFactory = (run: {
  runId: string
  model: string
  apiKey: string | null
  /** The piece the run works on now (it changes when the run creates one). */
  pieceId: () => string | null
}) => ModelClient

/** What the assistant's parts share; one per server. */
export interface AssistantDeps {
  runtime: Runtime
  driver: Driver
  bridge: ClientBridge
  keys: KeyStore
  model: ModelFactory
  /** A scripted test model stands in for Claude; no key is needed. */
  scripted: boolean
  env: Readonly<Record<string, string | undefined>>
  /** The studio window each live run's messages came from, for client tools. */
  clients: Map<string, string>
}

export class RunHost {
  readonly runId: string
  readonly threadId: string
  readonly model: string
  /** The run's context: its user's rights, acting as the run. */
  readonly ctx: Ctx
  readonly client: ModelClient
  readonly signal: AbortSignal
  readonly deps: AssistantDeps
  pieceId: string | null
  /** Optional request features; switched off for the rest of the session if the API rejects them. */
  features: Partial<RequestFeatures> = {}
  /** Re-issues spent in this session (a tool call cut off at max_tokens, a dropped stream). */
  truncationRetries = 0
  streamRetries = 0
  featureRetry = false
  /** The design version the model last saw, per piece, from what its calls returned. */
  readonly seen = new Map<string, number>()

  private constructor(init: {
    deps: AssistantDeps
    ctx: Ctx
    run: typeof t.agentRun.$inferSelect
    threadId: string
    client: ModelClient
    signal: AbortSignal
  }) {
    this.deps = init.deps
    this.ctx = init.ctx
    this.runId = init.run.id
    this.threadId = init.threadId
    this.model = init.run.model
    this.pieceId = init.run.pieceId
    this.client = init.client
    this.signal = init.signal
  }

  static async open(
    deps: AssistantDeps,
    who: { orgId: string; userId: string; runId: string },
    signal: AbortSignal,
  ): Promise<RunHost> {
    const base = await deps.runtime.context({ userId: who.userId, orgId: who.orgId })
    const run = await base.repo.runs.first(eq(t.agentRun.id, who.runId))
    if (!run?.threadId) throw notFound('Run', who.runId)
    const actor: Actor = { type: 'agent', runId: run.id, model: run.model }
    const ctx: Ctx = { ...base, actor }
    const apiKey = deps.scripted ? null : await deps.keys.key(ctx)
    let host: RunHost | null = null
    const client = deps.model({
      runId: run.id,
      model: run.model,
      apiKey,
      pieceId: () => host?.pieceId ?? null,
    })
    host = new RunHost({ deps, ctx, run, threadId: run.threadId, client, signal })
    return host
  }

  /** The context one tool call runs in. */
  forCall(toolCallId: string): Ctx {
    return {
      ...this.ctx,
      actor: { type: 'agent', runId: this.runId, toolCallId, model: this.model },
    }
  }

  emit(body: RunEventBody): void {
    this.deps.driver.emit(this.runId, body)
  }

  get clientId(): string | null {
    return this.deps.clients.get(this.runId) ?? null
  }
}
