/**
 * The assistant service: `threads.send`, `runs.decide`, `runs.cancel`, `client.respond` and boot
 * recovery, over the loop (./loop) and the live-run driver (./driver).
 */
import { modelForRun, PROMPT_HASH, resolveTiers } from '@pave/agent'
import type { CommandParsedInput, Run, Thread } from '@pave/schema'
import { and, eq } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { conflict, NotConfiguredError } from '../errors'
import { getPiece, getRun, getThread } from '../lookups'
import type { AssistantService, ServiceContext } from '../services'
import { addMessage, createThread, decideStep, startRun, toRun, toThread } from '../traces'
import { type AssistantDeps, RunHost } from './host'
import { closeDangling, closeOut, closeUnanswered, publishRun, runLoop } from './loop'
import { contextText, userContent } from './turn'

type Send = CommandParsedInput<'threads.send'>

/** A thread's title: its first message, cut at a word near 80 characters. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]!.trim()
  if (line.length <= 80) return line || 'New conversation'
  const cut = line.slice(0, 80)
  const space = cut.lastIndexOf(' ')
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export class Assistant implements AssistantService {
  readonly capabilities = { assistant: true }
  readonly #deps: AssistantDeps
  /** Sends in flight by `${userId}:${clientMessageId}`, so a double submit starts one run. */
  readonly #sending = new Map<string, Promise<{ thread: Thread; run: Run }>>()
  readonly #available: (orgId: string) => boolean

  constructor(deps: AssistantDeps, available: (orgId: string) => boolean) {
    this.#deps = deps
    this.#available = available
  }

  async available(orgId: string): Promise<boolean> {
    return this.#available(orgId)
  }

  #ctx(sctx: Pick<ServiceContext, 'orgId' | 'userId'>): Promise<Ctx> {
    return this.#deps.runtime.context({ userId: sctx.userId, orgId: sctx.orgId })
  }

  send(input: Send, sctx: ServiceContext): Promise<{ thread: Thread; run: Run }> {
    const key = `${sctx.orgId}:${sctx.userId}:${input.clientMessageId}`
    const inFlight = this.#sending.get(key)
    if (inFlight) return inFlight
    const p = this.#send(input, sctx).finally(() => this.#sending.delete(key))
    this.#sending.set(key, p)
    return p
  }

  async #send(input: Send, sctx: ServiceContext): Promise<{ thread: Thread; run: Run }> {
    const ctx = await this.#ctx(sctx)
    if (!this.#available(ctx.orgId))
      throw new NotConfiguredError(
        'assistant',
        'The assistant needs a Claude API key. An owner or admin can add one in Settings, AI (or set ANTHROPIC_API_KEY in apps/server/.env).',
      )

    // A retried send returns what the first one started.
    const sent = await ctx.repo.messages.first(
      and(
        eq(t.agentMessage.userId, ctx.user.id),
        eq(t.agentMessage.clientMessageId, input.clientMessageId),
      )!,
    )
    if (sent) {
      const thread = await getThread(ctx, sent.threadId)
      if (!sent.runId) throw conflict('This message was already sent')
      return { thread: toThread(thread), run: toRun(await getRun(ctx, sent.runId)) }
    }

    const thread = input.threadId
      ? toThread(await getThread(ctx, input.threadId))
      : await createThread(ctx, {
          title: titleFrom(input.text),
          pieceId: input.context.pieceId ?? null,
          boardId: input.context.boardId ?? null,
          sceneId: input.context.sceneId ?? null,
          promptHash: PROMPT_HASH,
        })
    await this.#settleThread(ctx, thread.id)

    const settings = await ctx.repo.settings.first()
    const resolved = resolveTiers(
      settings
        ? { assistantTier: settings.assistantTier, assistantModels: settings.assistantModels }
        : null,
      this.#deps.env,
    )
    const { tier, model } = modelForRun(resolved, input.tier)
    const pieceId = input.context.pieceId ?? thread.context.pieceId ?? null
    const piece = pieceId ? await getPiece(ctx, pieceId) : null
    const run = await startRun(ctx, {
      model,
      tier,
      threadId: thread.id,
      pieceId,
      baseSeq: piece?.version ?? null,
    })
    try {
      const { content, skipped } = await userContent(ctx, input)
      const message = await addMessage(ctx, {
        threadId: thread.id,
        runId: run.id,
        role: 'user',
        content,
        clientMessageId: input.clientMessageId,
      })
      if (message.runId !== run.id) {
        // Another send with the same id won the race: this run never started.
        await ctx.repo.runs.delete(eq(t.agentRun.id, run.id))
        return {
          thread: toThread(await getThread(ctx, message.threadId)),
          run: toRun(await getRun(ctx, message.runId!)),
        }
      }
      const text = await contextText(
        ctx,
        input,
        { id: run.id, threadId: thread.id, pieceId },
        skipped,
      )
      await addMessage(ctx, {
        threadId: thread.id,
        runId: run.id,
        role: 'system',
        content: [{ type: 'text', text }],
      })
    } catch (err) {
      await closeOut(ctx, run.id, {
        status: 'failed',
        error: 'The message could not be stored.',
        errorCode: 'internal',
      })
      throw err
    }
    this.#deps.clients.set(run.id, input.clientId)
    this.#start(sctx, run.id, thread.id)
    return { thread, run }
  }

  /**
   * One run per thread: a live run is stopped, and approvals still waiting are declined (the run
   * that waited for them ends). A thread left with unanswered tool calls is closed off.
   */
  async #settleThread(ctx: Ctx, threadId: string): Promise<void> {
    const live = this.#deps.driver.liveInThread(threadId)
    if (live) await this.#deps.driver.abort(live, 'cancel')
    const waiting = await ctx.repo.runs.many({
      where: and(eq(t.agentRun.threadId, threadId), eq(t.agentRun.status, 'awaiting-approval'))!,
    })
    for (const r of waiting) {
      await ctx.repo.steps.update(
        and(eq(t.agentStep.runId, r.id), eq(t.agentStep.status, 'awaiting-approval'))!,
        { status: 'denied' },
      )
      await closeOut(ctx, r.id, { status: 'canceled', error: 'Superseded by a new message.' })
    }
    await closeDangling(ctx, threadId, null, 'the designer sent a new message')
    await closeUnanswered(ctx, threadId)
  }

  /** Starts (or nudges) the run's session in the driver; failures end the run, never the server. */
  #start(who: Pick<ServiceContext, 'orgId' | 'userId'>, runId: string, threadId: string): void {
    const { driver } = this.#deps
    void driver.start(runId, threadId, async (signal) => {
      const deps = this.#deps
      let host: RunHost | null = null
      try {
        host = await RunHost.open(deps, { ...who, runId }, signal)
        const row = await host.ctx.repo.runs.first(eq(t.agentRun.id, runId))
        // A nudge after the run already ended or still waits finds nothing to announce.
        if (row?.status === 'running') {
          const run = toRun(row)
          host.emit({ type: 'run.started', run })
          // Other windows of the user learn the run is going (again) and may open its stream.
          publishRun(host.ctx, run)
        }
        await runLoop(host)
      } catch (err) {
        const ctx = host?.ctx ?? (await this.#ctx(who).catch(() => null))
        if (!ctx) return
        const emit = host ? host.emit.bind(host) : undefined
        if (signal.aborted) {
          const shutdown = signal.reason === 'shutdown'
          await closeOut(ctx, runId, {
            status: shutdown ? 'failed' : 'canceled',
            error: shutdown ? 'Interrupted: the server stopped. Send the message again.' : null,
            errorCode: shutdown ? 'interrupted' : null,
            emit,
          }).catch((e) => console.error('Ending a stopped run failed:', e))
          return
        }
        const notConfigured = err instanceof NotConfiguredError
        if (!notConfigured) console.error(`Assistant run ${runId} failed:`, err)
        await closeOut(ctx, runId, {
          status: 'failed',
          error: notConfigured
            ? err.message
            : 'Something went wrong in the assistant. Try again; your edits so far can be undone.',
          errorCode: notConfigured ? 'provider_auth' : 'internal',
          emit,
        }).catch((e) => console.error('Ending a failed run failed:', e))
      } finally {
        const run = host
          ? await host.ctx.repo.runs.first(eq(t.agentRun.id, runId)).catch(() => undefined)
          : undefined
        if (run && run.status !== 'running' && run.status !== 'awaiting-approval')
          this.#deps.clients.delete(runId)
      }
    })
  }

  async decide(input: CommandParsedInput<'runs.decide'>, sctx: ServiceContext): Promise<Run> {
    const ctx = await this.#ctx(sctx)
    if (!this.#available(ctx.orgId) && input.decision === 'approve')
      throw new NotConfiguredError(
        'assistant',
        'The assistant has no Claude API key any more, so it cannot go on. Add one in Settings, AI.',
      )
    const run = await getRun(ctx, input.runId)
    await decideStep(ctx, input.runId, input.toolCallId, {
      decision: input.decision,
      note: input.note ?? null,
    })
    if (run.threadId) this.#start(sctx, run.id, run.threadId)
    return toRun(await getRun(ctx, input.runId))
  }

  async cancel(runId: string, sctx: ServiceContext): Promise<Run> {
    const ctx = await this.#ctx(sctx)
    if (this.#deps.driver.isLive(runId)) await this.#deps.driver.abort(runId, 'cancel')
    const run = await getRun(ctx, runId)
    if (run.status === 'awaiting-approval' || run.status === 'running')
      return closeOut(ctx, runId, { status: 'canceled' })
    return toRun(run)
  }

  async respond(input: CommandParsedInput<'client.respond'>, sctx: ServiceContext): Promise<void> {
    this.#deps.bridge.respond({ orgId: sctx.orgId, userId: sctx.userId }, input)
  }

  /** Boot: a run cut off mid-step cannot be trusted to continue; one waiting for a person can. */
  async resume(run: Run, sctx: ServiceContext): Promise<void> {
    if (run.status !== 'running') return
    const ctx = await this.#ctx(sctx)
    await closeOut(ctx, run.id, {
      status: 'failed',
      error: 'Interrupted by a server restart. Send the message again to go on.',
      errorCode: 'interrupted',
    })
  }
}
