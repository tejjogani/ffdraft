/**
 * The assistant service: `threads.send`, `runs.decide`, `runs.cancel`, `client.respond` and boot
 * recovery, over the loop (./loop) and the live-run driver (./driver).
 */
import {
  continueJob,
  jobMessage,
  modelForRun,
  newJob,
  PROMPT_HASH,
  resolveTiers,
} from '@pave/agent'
import type { AiJob, CommandOutput, CommandParsedInput, Run, Thread } from '@pave/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { ClaudeCall, Ctx } from '../context'
import * as t from '../db/schema'
import { conflict, NotConfiguredError } from '../errors'
import { createId } from '../ids'
import { getPiece, getRun, getThread } from '../lookups'
import type { AssistantService, ServiceContext } from '../services'
import { addMessage, createThread, decideStep, setJob, startRun, toRun, toThread } from '../traces'
import { isPauseReason, type PauseReason } from './driver'
import { type AssistantDeps, RunHost } from './host'
import { closeDangling, closeOut, closeUnanswered, LIVE_RUNS, publishRun, runLoop } from './loop'
import { readPhotos } from './read'
import type { Waiter } from './takes'
import { contextText, userContent } from './turn'

type Send = CommandParsedInput<'threads.send'>

/** A job that a new message in its thread carries on: its outputs await review, or it was cut short. */
const carriesOn = (run: Run): boolean =>
  !!run.job &&
  (run.job.review === 'pending' ||
    run.status === 'paused' ||
    run.status === 'running' ||
    run.status === 'awaiting-approval' ||
    run.status === 'waiting')

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
  /**
   * Runs being stopped right now. Canceling a run's takes settles them, and a settled take wakes
   * the run that waited for it: without this, Stop could start one more model call between
   * canceling the takes and marking the run canceled. One event loop, so the set needs no lock.
   */
  readonly #stopping = new Set<string>()

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

  send(input: Send, sctx: ServiceContext, carried?: AiJob): Promise<{ thread: Thread; run: Run }> {
    const key = `${sctx.orgId}:${sctx.userId}:${input.clientMessageId}`
    const inFlight = this.#sending.get(key)
    if (inFlight) return inFlight
    const p = this.#send(input, sctx, carried).finally(() => this.#sending.delete(key))
    this.#sending.set(key, p)
    return p
  }

  async #send(
    input: Send,
    sctx: ServiceContext,
    carried?: AiJob,
  ): Promise<{ thread: Thread; run: Run }> {
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

    // The AI job this run is: a new one for a stage, one carried on by Resume, or the thread's
    // last job carried on by a message about it (asked before the thread is settled, which
    // stops a running job).
    let job: AiJob | null =
      carried ??
      (input.job
        ? {
            ...newJob(input.job.stage, input.job.goal),
            ...(input.job.machineSeconds !== undefined
              ? { machineSeconds: input.job.machineSeconds }
              : {}),
          }
        : null)
    if (!job && input.threadId && !input.context.brainstorm && !input.context.intake) {
      const last = await ctx.repo.runs.first(
        eq(t.agentRun.threadId, input.threadId),
        desc(t.agentRun.startedAt),
      )
      if (last && carriesOn(toRun(last))) job = continueJob(last.job!, last.id).job
    }
    // A job started from a stage reads as its plan; the person's own words follow it.
    if (input.job && job) {
      const plan = jobMessage(job, { type: 'start' })
      const note = input.text.trim()
      input = { ...input, text: note && note !== job.goal ? `${plan}\n\n${note}` : plan }
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
      job,
      // Spend on a piece counts against the stage tab it was asked from (a job's own stage wins).
      stage: pieceId ? (input.context.stage ?? null) : null,
    })
    try {
      const runRef = { id: run.id, threadId: thread.id, pieceId }
      const { content, media } = await userContent(ctx, input, runRef)
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
      const text = await contextText(ctx, input, runRef, media)
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
    // A run waiting for its takes ends too; the takes carry on into the Render tab.
    const waiting = await ctx.repo.runs.many({
      where: and(
        eq(t.agentRun.threadId, threadId),
        inArray(t.agentRun.status, ['awaiting-approval', 'waiting']),
      )!,
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
          const pause = isPauseReason(signal.reason) ? signal.reason : null
          await closeOut(ctx, runId, {
            status: shutdown ? 'failed' : pause ? 'paused' : 'canceled',
            error: shutdown ? 'Interrupted: the server stopped. Send the message again.' : null,
            errorCode: shutdown ? 'interrupted' : null,
            pausedBy: pause,
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
        if (run && !LIVE_RUNS.includes(run.status)) this.#deps.clients.delete(runId)
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
      ...(input.answers ? { answers: input.answers } : {}),
    })
    if (run.threadId) this.#start(sctx, run.id, run.threadId)
    return toRun(await getRun(ctx, input.runId))
  }

  async cancel(runId: string, sctx: ServiceContext): Promise<Run> {
    const ctx = await this.#ctx(sctx)
    if (this.#deps.driver.isLive(runId)) await this.#deps.driver.abort(runId, 'cancel')
    const run = await getRun(ctx, runId)
    if (!LIVE_RUNS.includes(run.status)) return toRun(run)
    this.#stopping.add(runId)
    try {
      await this.#cancelTakes(ctx, runId)
      return await closeOut(ctx, runId, { status: 'canceled' })
    } finally {
      this.#stopping.delete(runId)
    }
  }

  /** Stop means stop: the takes a stopped run is still waiting for are canceled with it. */
  async #cancelTakes(ctx: Ctx, runId: string): Promise<void> {
    const steps = await ctx.repo.steps.many({
      where: and(eq(t.agentStep.runId, runId), eq(t.agentStep.status, 'waiting'))!,
    })
    for (const s of steps) {
      const id = (s.output as { value?: { id?: string } } | null)?.value?.id
      if (!id) continue
      await this.#deps.runtime
        .execute('renders.cancel', { id }, ctx)
        // Already finished (or canceled by hand): nothing to stop.
        .catch(() => {})
      // Its call is then answered as canceled, not as still rendering.
      await ctx.repo.steps.update(
        and(eq(t.agentStep.id, s.id), eq(t.agentStep.status, 'waiting'))!,
        {
          status: 'canceled',
        },
      )
    }
  }

  /**
   * A take a run waited for has settled: the run goes on. The loop re-reads every take it
   * waits on, so a wake for a run that is no longer waiting does nothing.
   */
  wake(w: Waiter): void {
    if (this.#stopping.has(w.runId)) return
    void (async () => {
      const ctx = await this.#ctx({ orgId: w.orgId, userId: w.userId })
      const run = await ctx.repo.runs.first(eq(t.agentRun.id, w.runId))
      // Checked again after the read: the designer may have pressed Stop meanwhile.
      if (this.#stopping.has(w.runId)) return
      if (run?.status !== 'waiting' && !this.#deps.driver.isLive(w.runId)) return
      this.#start({ orgId: w.orgId, userId: w.userId }, w.runId, w.threadId)
    })().catch((err) => console.error(`Waking run ${w.runId} failed:`, err))
  }

  /**
   * Pauses an AI job where it is: a live run is stopped (its edits stay), one waiting for an
   * approval stops waiting. Resume starts a new run that replans from the piece as it is then.
   */
  async pause(runId: string, reason: PauseReason, sctx: ServiceContext): Promise<Run> {
    const ctx = await this.#ctx(sctx)
    const run = toRun(await getRun(ctx, runId))
    if (!run.job) throw conflict('Only an AI job can be paused; stop this run instead')
    if (this.#deps.driver.isLive(runId)) await this.#deps.driver.abort(runId, reason)
    const now = toRun(await getRun(ctx, runId))
    if (LIVE_RUNS.includes(now.status))
      return closeOut(ctx, runId, { status: 'paused', pausedBy: reason })
    return now
  }

  /** Carries an AI job on in a new run of its thread (Resume, or redoing a step). */
  async resumeJob(
    input: CommandParsedInput<'runs.resume'>,
    sctx: ServiceContext,
  ): Promise<{ thread: Thread; run: Run }> {
    const ctx = await this.#ctx(sctx)
    const run = toRun(await getRun(ctx, input.runId))
    if (!run.job || !run.threadId) throw conflict('Only an AI job can be resumed')
    if (input.redoStepId && !run.job.plan.some((s) => s.id === input.redoStepId))
      throw conflict(`The job has no step ${input.redoStepId}`)
    const { job, redo } = continueJob(run.job, run.id, input.redoStepId)
    const text = jobMessage(job, redo ? { type: 'redo', step: redo.label } : { type: 'resume' })
    return this.send(
      {
        threadId: run.threadId,
        text,
        attachments: [],
        referenceIds: [],
        context: { pieceId: run.pieceId ?? undefined, selection: [] },
        tier: input.tier ?? run.tier ?? undefined,
        clientId: input.clientId,
        clientMessageId: input.clientMessageId,
      },
      sctx,
      job,
    )
  }

  /** Ends an AI job's review: its outputs are accepted as they are now. */
  async accept(runId: string, sctx: ServiceContext): Promise<Run> {
    const ctx = await this.#ctx(sctx)
    const run = toRun(await getRun(ctx, runId))
    if (run.job?.review !== 'pending' || !run.job)
      throw conflict('Nothing of this run waits for review')
    const accepted = await setJob(ctx, runId, { ...run.job, review: 'accepted' })
    publishRun(ctx, accepted)
    return accepted
  }

  async respond(input: CommandParsedInput<'client.respond'>, sctx: ServiceContext): Promise<void> {
    this.#deps.bridge.respond({ orgId: sctx.orgId, userId: sctx.userId }, input)
  }

  /**
   * `references.read` outside a run (a person, or MCP): on the organisation's default tier, with
   * its own client. Inside a run the loop reads on the run's client instead (see ./loop).
   */
  async readPhotos(
    input: CommandParsedInput<'references.read'>,
    sctx: ServiceContext,
  ): Promise<CommandOutput<'references.read'>> {
    const ctx = await this.#ctx(sctx)
    if (!this.#available(ctx.orgId))
      throw new NotConfiguredError(
        'assistant',
        'Reading photos needs a Claude API key. An owner or admin can add one in Settings, AI.',
      )
    const settings = await ctx.repo.settings.first()
    const resolved = resolveTiers(
      settings
        ? { assistantTier: settings.assistantTier, assistantModels: settings.assistantModels }
        : null,
      this.#deps.env,
    )
    const { model } = modelForRun(resolved, undefined)
    const id = createId('read')
    const client = this.#deps.model({
      runId: id,
      model,
      apiKey: this.#deps.scripted ? null : await this.#deps.keys.key(ctx),
      pieceId: () => null,
    })
    const { output } = await readPhotos({
      ctx: { ...ctx, actor: sctx.actor },
      client,
      model,
      input,
      usage: { key: `${id}:llm`, runId: null, pieceId: null },
    })
    return output
  }

  /**
   * A Claude client on the organisation's default tier for a command's own structured call
   * outside a run (an image brief, the check of generated images), metered by the caller.
   */
  async claude(sctx: ServiceContext, purpose: string): Promise<ClaudeCall> {
    const ctx = await this.#ctx(sctx)
    if (!this.#available(ctx.orgId))
      throw new NotConfiguredError(
        'assistant',
        'This needs a Claude API key. An owner or admin can add one in Settings, AI.',
      )
    const settings = await ctx.repo.settings.first()
    const resolved = resolveTiers(
      settings
        ? { assistantTier: settings.assistantTier, assistantModels: settings.assistantModels }
        : null,
      this.#deps.env,
    )
    const { model } = modelForRun(resolved, undefined)
    const id = createId(purpose.slice(0, 8) || 'call')
    const client = this.#deps.model({
      runId: id,
      model,
      apiKey: this.#deps.scripted ? null : await this.#deps.keys.key(ctx),
      pieceId: () => null,
    })
    return { client, model, key: id, runId: null, spent: async () => {} }
  }

  /**
   * Boot: a run cut off mid-step cannot be trusted to continue; one waiting for a person can, and
   * one waiting for its takes is nudged once, so it registers them again (or goes on, if they
   * finished while the server was down).
   */
  async resume(run: Run, sctx: ServiceContext): Promise<void> {
    if (run.status === 'waiting' && run.threadId) {
      this.#start(sctx, run.id, run.threadId)
      return
    }
    if (run.status !== 'running') return
    const ctx = await this.#ctx(sctx)
    await closeOut(ctx, run.id, {
      status: 'failed',
      error: 'Interrupted by a server restart. Send the message again to go on.',
      errorCode: 'interrupted',
    })
  }
}
