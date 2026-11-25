/**
 * The run loop. `step(host)` reads where the run stands from the database and does the next
 * thing — one model call, or the tool calls of the last assistant turn — and stores what came of
 * it before returning, so any session (a fresh driver after an approval or a restart) can pick
 * the run up where it is:
 *
 *   last message is the assistant's, with tool calls unanswered → run them (queries at once,
 *     mutations in order; a call that needs approval waits, the others run first), then store
 *     all results in one user message;
 *   otherwise → one model call on the append-only conversation, then store its turn.
 *
 * Every way a run ends closes tool calls left unanswered with a result, so the conversation
 * stays valid for the next message.
 */

import type {
  BetaMessage,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import {
  admit,
  advanceJob,
  canonText,
  capMessage,
  checkOverlap,
  closedResult,
  describeCall,
  endJob,
  errorResult,
  evaluationNote,
  invalidInputResult,
  jobApproves,
  jobMachineBudget,
  MAX_RETAKES,
  parseToolCall,
  recordAnswers,
  repeatedFailure,
  runCap,
  type ShapeImage,
  shapeResult,
  type ToolDef,
} from '@pave/agent'
import {
  buildRequest,
  classifyStop,
  effectiveContent,
  isRequestRejected,
  isStreamBreak,
  mapError,
  messageUsage,
  turnFallbacks,
  type RunErrorCode,
  StreamAdapter,
  toApiMessages,
} from '@pave/agent/anthropic'
import { lintDesign } from '@pave/canon'
import { roughCost } from '@pave/production'
import type {
  AiJob,
  AssistantModelId,
  ClientToolName,
  ClientToolParsedInput,
  CommandName,
  CommandOutput,
  CommandParsedInput,
  Design,
  EvaluationSummary,
  RenderJob,
  Run,
  SavedScene,
  Tokens,
} from '@pave/schema'
import { resolveAnswers } from '@pave/schema'
import { and, asc, desc, eq, gt, inArray, isNull, max, ne, or } from 'drizzle-orm'
import { readAsset } from '../assets/assets'
import { framingRefusal } from '../cinema'
import { type ClaudeCall, type Ctx, publish } from '../context'
import * as t from '../db/schema'
import { AppError } from '../errors'
import { getPiece } from '../lookups'
import { serviceContext } from '../service-context'
import {
  addMessage,
  addStep,
  addUsage,
  beginStep,
  completeStep,
  finishRun,
  resumeRun,
  setJob,
  toRun,
} from '../traces'
import { assertBudget, recordUsage } from '../usage'
import { lastFreeTracker } from './allowance'
import { NoWindow } from './bridge'
import { cameraNote } from './camera-note'
import { captureOnServer } from './capture'
import type { RunHost } from './host'
import { modelImage } from './images'
import { readPhotos } from './read'
import { lastReadOf, placeTakePlane } from './take-plane'
import { expireBrowserTake, takeResult, waitFor } from './takes'

export type StepOutcome = 'continue' | 'suspended' | 'finished'

/** A run in one of these may still go on. */
export const LIVE_RUNS: Run['status'][] = ['running', 'awaiting-approval', 'waiting']

type MessageRow = typeof t.agentMessage.$inferSelect
type StepRow = typeof t.agentStep.$inferSelect

/** What a tool step stores as output: the command's own output and the result the model read. */
export interface ToolStepOutput {
  value: unknown
  /** Null while the call's take renders (the step is `waiting`). */
  result: BetaToolResultBlockParam | null
}

const toolUses = (content: readonly Record<string, unknown>[]): BetaToolUseBlock[] =>
  content.filter((b) => b.type === 'tool_use') as unknown as BetaToolUseBlock[]

async function loadMessages(ctx: Ctx, threadId: string): Promise<MessageRow[]> {
  return ctx.repo.messages.many({
    where: eq(t.agentMessage.threadId, threadId),
    orderBy: asc(t.agentMessage.seq),
  })
}

async function loadSteps(ctx: Ctx, runId: string): Promise<StepRow[]> {
  return ctx.repo.steps.many({ where: eq(t.agentStep.runId, runId), orderBy: asc(t.agentStep.idx) })
}

async function nextIndex(ctx: Ctx, runId: string): Promise<number> {
  const [row] = await ctx.repo.steps.select(
    { idx: max(t.agentStep.idx) },
    eq(t.agentStep.runId, runId),
  )
  return (row?.idx ?? -1) + 1
}

const storedResult = (s: StepRow): BetaToolResultBlockParam | null => {
  const out = s.output as Partial<ToolStepOutput> | null
  return out && typeof out === 'object' && out.result ? out.result : null
}

/** The result a step already settled gives, or null while it still has to run or wait. */
function settledResult(s: StepRow, toolUseId: string): BetaToolResultBlockParam | null {
  if (s.status === 'done' || s.status === 'failed')
    return storedResult(s) ?? closedResult(toolUseId, 'its result was lost')
  if (s.status === 'denied' && s.name === 'chat.ask')
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: [
        {
          type: 'text',
          text: 'The designer did not pick from these options. If they wrote a message, it is their answer; otherwise go on with the defaults you offered. Do not ask again.',
        },
      ],
    }
  if (s.status === 'denied') {
    const note = s.approval?.note ? ` Their note: ${s.approval.note}` : ''
    return errorResult(
      toolUseId,
      `The designer declined this; nothing was run.${note} Do not ask again unless they change their mind.`,
    )
  }
  if (s.status === 'canceled') return closedResult(toolUseId, 'canceled')
  if (s.status === 'waiting') {
    const take = (s.output as { value?: { id?: string } } | null)?.value?.id
    // Not an error: the take carries on and lands in the Render tab.
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: [
        {
          type: 'text',
          text: `Take ${take ?? '(unknown)'} was still rendering when this run ended; it carries on and will appear in the Render tab. Use renders.get to see how it turned out.`,
        },
      ],
    }
  }
  return null
}

// ── Ending a run ────────────────────────────────────────────────────────────────────────────

/**
 * Ends a run, first answering any tool call of its last turn that has no result yet (with the
 * stored result where a call finished, otherwise as not run), so the thread stays valid.
 */
export async function closeOut(
  ctx: Ctx,
  runId: string,
  end: {
    status: Exclude<Run['status'], 'running' | 'awaiting-approval' | 'waiting'>
    error?: string | null
    errorCode?: RunErrorCode | null
    emit?: RunHost['emit']
    /** For a paused AI job: what paused it. */
    pausedBy?: AiJob['pausedBy']
  },
): Promise<Run> {
  const run = await ctx.repo.runs.first(eq(t.agentRun.id, runId))
  if (run?.threadId)
    await closeDangling(ctx, run.threadId, runId, end.error ?? end.status, end.emit)
  // Steps still open are over too.
  await ctx.repo.steps.update(
    and(
      eq(t.agentStep.runId, runId),
      inArray(t.agentStep.status, ['running', 'awaiting-approval', 'waiting']),
    )!,
    { status: 'canceled' },
  )
  const finished = await finishRun(ctx, runId, {
    status: end.status,
    error: end.error ?? null,
    errorCode: end.errorCode ?? null,
    // Only a run still live settles its plan; one already ended keeps the record it ended with.
    job:
      run?.job && LIVE_RUNS.includes(run.status)
        ? endJob(run.job, end.status, end.pausedBy ?? null)
        : undefined,
  })
  if (finished.job) end.emit?.({ type: 'job.updated', job: finished.job })
  end.emit?.({ type: 'run.finished', run: finished })
  publishRun(ctx, finished)
  return finished
}

/**
 * Answers the unanswered tool calls of a thread's last assistant turn. Also used before a new
 * message, so a run that ended without this (a crash, an old version) cannot break the thread.
 */
export async function closeDangling(
  ctx: Ctx,
  threadId: string,
  runId: string | null,
  reason: string,
  emit?: RunHost['emit'],
): Promise<void> {
  const messages = await loadMessages(ctx, threadId)
  const last = messages.at(-1)
  if (last?.role !== 'assistant') return
  // Only a run's own turn is closed by it; another run's calls are that run's to answer.
  if (runId && last.runId && last.runId !== runId) return
  const calls = toolUses(last.content)
  if (!calls.length) return
  const owner = runId ?? last.runId
  const steps = owner ? await loadSteps(ctx, owner) : []
  const results = calls.map((c) => {
    const s = steps.find((x) => x.toolCallId === c.id)
    return (s && settledResult(s, c.id)) ?? closedResult(c.id, reason)
  })
  const message = await addMessage(ctx, {
    threadId,
    runId: owner,
    role: 'user',
    content: results as unknown as Record<string, unknown>[],
  })
  emit?.({ type: 'message.completed', message })
}

/**
 * Before a new message: a run that ended without answering (stopped, refused, out of budget)
 * leaves the thread on its context message, and a system message may only be followed by an
 * assistant turn. A short assistant note saying there was no answer keeps the thread valid and
 * append-only, and tells the model what happened.
 */
export async function closeUnanswered(ctx: Ctx, threadId: string): Promise<void> {
  const [last] = await ctx.repo.messages.many({
    where: eq(t.agentMessage.threadId, threadId),
    orderBy: desc(t.agentMessage.seq),
    limit: 1,
  })
  if (last?.role !== 'system') return
  const run = last.runId ? await ctx.repo.runs.first(eq(t.agentRun.id, last.runId)) : undefined
  const why =
    run?.status === 'canceled'
      ? 'the designer stopped it'
      : run?.error
        ? run.error
        : 'it was interrupted'
  await addMessage(ctx, {
    threadId,
    runId: last.runId,
    role: 'assistant',
    content: [{ type: 'text', text: `(No answer to that message: ${why})` }],
  })
}

export function publishRun(ctx: Ctx, run: Run): void {
  publish(
    ctx,
    { type: 'run.updated', runId: run.id, threadId: run.threadId, status: run.status },
    { userId: run.userId },
  )
}

/**
 * An AI job's plan follows its tool calls (`advanceJob`). Reads run at once, so moves are
 * chained per run: each reads the plan the previous one wrote.
 */
function moveJob(host: RunHost, command: string): Promise<void> {
  return changeJob(host, (job) => advanceJob(job, command))
}

/** Any change to the run's job record, chained like the plan's moves (null changes nothing). */
function changeJob(host: RunHost, change: (job: AiJob) => AiJob | null): Promise<void> {
  const next = host.jobChain.then(async () => {
    const run = await host.ctx.repo.runs.first(eq(t.agentRun.id, host.runId))
    const moved = run?.job ? change(run.job) : null
    if (!moved) return
    await setJob(host.ctx, host.runId, moved)
    host.emit({ type: 'job.updated', job: moved })
  })
  // A failed move must not block later ones; the plan is progress, not truth.
  host.jobChain = next.catch((err) => console.error('Moving a job plan failed:', err))
  return host.jobChain
}

// ── One step ─────────────────────────────────────────────────────────────────────────────────

export async function runLoop(host: RunHost): Promise<void> {
  for (;;) {
    if (host.signal.aborted) throw host.signal.reason
    const outcome = await step(host)
    if (outcome !== 'continue') return
  }
}

export async function step(host: RunHost): Promise<StepOutcome> {
  const { ctx, runId } = host
  let run = await ctx.repo.runs.first(eq(t.agentRun.id, runId))
  if (!run) return 'finished'
  if (run.status === 'awaiting-approval' || run.status === 'waiting') {
    // A decision (or a take) may have landed while the last session was still suspending: go
    // on if nothing waits any more.
    if (await stillWaiting(host)) return 'suspended'
    const wasWaiting = run.status === 'waiting'
    const resumed = await resumeRun(ctx, runId)
    if (wasWaiting && resumed.status === 'running') {
      // Woken by its takes: windows learn the run is going again and open its stream.
      host.emit({ type: 'run.started', run: resumed })
      publishRun(ctx, resumed)
    }
    run = await ctx.repo.runs.first(eq(t.agentRun.id, runId))
  }
  if (run?.status !== 'running') return 'finished'

  const messages = await loadMessages(ctx, host.threadId)
  const last = messages.at(-1)
  if (last?.role === 'assistant') {
    const calls = toolUses(last.content)
    if (calls.length) return runTools(host, calls)
    // An assistant turn without calls ends the run, unless compaction paused it to be sent back.
    const lastModel = await ctx.repo.steps.first(
      and(eq(t.agentStep.runId, runId), eq(t.agentStep.kind, 'model')),
      desc(t.agentStep.idx),
    )
    if (lastModel?.stopReason !== 'compaction') {
      await closeOut(ctx, runId, { status: 'done', emit: host.emit.bind(host) })
      return 'finished'
    }
  }
  return callModel(host, messages, toRun(run))
}

// ── The model call ───────────────────────────────────────────────────────────────────────────

async function fail(host: RunHost, code: RunErrorCode, message: string): Promise<StepOutcome> {
  await closeOut(host.ctx, host.runId, {
    status: 'failed',
    error: message,
    errorCode: code,
    emit: host.emit.bind(host),
  })
  return 'finished'
}

/** One model call into the ledger (keyed by run and step) and the run's cost. */
async function meterModelCall(
  host: RunHost,
  idx: number,
  usage: { model: string; tokens: Tokens; costUsd: number },
): Promise<void> {
  const { ctx, runId } = host
  await recordUsage(ctx, {
    meter: 'llm',
    provider: 'anthropic',
    model: usage.model,
    quantity:
      usage.tokens.input + usage.tokens.output + usage.tokens.cacheRead + usage.tokens.cacheWrite,
    unit: 'tokens',
    costUsd: usage.costUsd,
    idempotencyKey: `${runId}:${idx}:llm`,
    runId,
    pieceId: host.pieceId,
    stage: host.stage,
  })
  await addUsage(ctx, runId, usage)
  host.emit({ type: 'usage', tokens: usage.tokens, costUsd: usage.costUsd })
}

async function callModel(host: RunHost, messages: MessageRow[], run: Run): Promise<StepOutcome> {
  const { ctx, runId } = host
  const turns = await ctx.repo.steps.count(
    and(
      eq(t.agentStep.runId, runId),
      eq(t.agentStep.kind, 'model'),
      eq(t.agentStep.isError, false),
    ),
  )
  const cap = runCap({ turns, costUsd: run.costUsd })
  if (cap) return fail(host, 'run_cap', capMessage(cap))
  try {
    await assertBudget(ctx)
  } catch (err) {
    if (err instanceof AppError && err.code === 'budget_exceeded')
      return fail(host, 'budget_exceeded', err.message)
    throw err
  }

  const idx = await nextIndex(ctx, runId)
  const params = buildRequest({
    model: host.model as AssistantModelId,
    messages: toApiMessages(messages),
    features: host.features,
  })
  const started = Date.now()
  const adapter = new StreamAdapter()
  let message: BetaMessage
  try {
    const stream = host.client.stream(params, { signal: host.signal })
    for await (const event of stream) for (const body of adapter.push(event)) host.emit(body)
    message = await stream.finalMessage()
  } catch (err) {
    // Billed even though no final message came: the input the API reported and the output it
    // streamed. Recorded before stopping or retrying, so the budget and the run cap see it.
    const partial = adapter.partialUsage()
    if (partial) await meterModelCall(host, idx, partial)
    if (host.signal.aborted) throw host.signal.reason
    const mapped = mapError(err, { model: host.model })
    await addStep(ctx, runId, {
      index: idx,
      kind: 'model',
      name: host.model,
      input: { model: host.model, messages: messages.length, features: host.features },
      output: { error: mapped.message },
      isError: true,
      ms: Date.now() - started,
      ...(partial ? { usage: { ...partial.tokens, costUsd: partial.costUsd } } : {}),
    })
    // An optional request feature the API does not take: try once more without them.
    if (isRequestRejected(err) && !host.featureRetry) {
      host.featureRetry = true
      host.features = { compaction: false, dropMismatchedThinking: false }
      return 'continue'
    }
    // A stream cut off mid-answer or a tool input that could not be parsed: ask again (twice).
    if (isStreamBreak(err) && host.streamRetries < 2) {
      host.streamRetries++
      return 'continue'
    }
    return fail(host, mapped.code, mapped.message)
  }
  host.streamRetries = 0

  const usage = messageUsage(message)
  await meterModelCall(host, idx, { model: message.model, ...usage })

  const outcome = classifyStop(message)
  await addStep(ctx, runId, {
    index: idx,
    kind: 'model',
    name: host.model,
    input: { model: host.model, messages: messages.length, features: host.features },
    output: {
      servedBy: adapter.servedBy ?? message.model,
      inputTransformations: adapter.inputTransformations,
      outcome: outcome.kind,
    },
    ms: Date.now() - started,
    usage: { ...usage.tokens, costUsd: usage.costUsd },
    stopReason: message.stop_reason,
  })

  const store = async () => {
    const content = effectiveContent(message.content)
    const stored = await addMessage(ctx, {
      threadId: host.threadId,
      runId,
      role: 'assistant',
      // Exactly as the API returned it: thinking must go back byte for byte.
      content: JSON.parse(JSON.stringify(content)) as Record<string, unknown>[],
    })
    host.emit({ type: 'message.completed', message: stored })
  }

  switch (outcome.kind) {
    case 'refusal':
      // A declined turn is not stored or acted on: its tool calls may be cut short.
      return fail(
        host,
        'refusal',
        `Claude declined this request${outcome.category ? ` (${outcome.category})` : ''}. Try rephrasing it${
          turnFallbacks(host.model as AssistantModelId) ? '' : ', or switch to a stronger tier'
        }.`,
      )
    case 'max_tokens':
      if (outcome.hasToolCall) {
        // The call may be cut short: never run it. Ask once more; a second cut is an error.
        if (host.truncationRetries++ < 1) return 'continue'
        return fail(
          host,
          'internal',
          'The assistant’s answer was too long and was cut off twice. Ask for a smaller step.',
        )
      }
      await store()
      await closeOut(ctx, runId, { status: 'done', emit: host.emit.bind(host) })
      return 'finished'
    case 'context_full':
      return fail(
        host,
        'internal',
        'This conversation no longer fits the model’s memory. Start a new conversation.',
      )
    case 'continue':
      await store()
      // A paused turn is resumed by sending it back as it is, which only works after server
      // tools (the turn then ends in their results). The assistant has none: sending a turn that
      // ends in its own text is a prefill, which these models refuse. Keep what it said and end
      // the run; its tool calls, if any, still run next.
      if (
        message.stop_reason === 'pause_turn' &&
        !effectiveContent(message.content).some((b) => b.type === 'tool_use')
      ) {
        await closeOut(ctx, runId, { status: 'done', emit: host.emit.bind(host) })
        return 'finished'
      }
      return 'continue'
    case 'tools':
      await store()
      return 'continue'
    case 'end':
      await store()
      await closeOut(ctx, runId, { status: 'done', emit: host.emit.bind(host) })
      return 'finished'
  }
}

// ── Tool calls ───────────────────────────────────────────────────────────────────────────────

interface Job {
  call: BetaToolUseBlock
  def: ToolDef
  input: unknown
  index: number
}

/** The plain sentence an approval card shows. */
function approvalSummary(def: ToolDef, input: unknown): string {
  const i = input as Record<string, unknown>
  switch (def.command) {
    case 'pieces.buildFromSpec':
      return 'Build the CAD from the saved spec. It replaces the current design; you can undo it.'
    case 'pieces.delete':
      return 'Delete this piece and its history.'
    case 'boards.delete':
      return 'Delete this board.'
    case 'references.generate':
      return `Generate ${typeof i.count === 'number' ? i.count : 2} images from a prompt. This is paid.`
    case 'mesh3d.create':
      return 'Turn photos into a 3D model with an outside service. This is paid.'
    case 'chat.ask':
      return typeof i.intro === 'string' ? i.intro : 'A few quick questions.'
    case 'renders.create': {
      const scene = i.scene as { output?: { width?: number; height?: number } } | undefined
      const what = typeof i.variantLabel === 'string' ? ` in ${i.variantLabel}` : ''
      const size = scene?.output?.width
        ? ` at ${scene.output.width}×${scene.output.height ?? scene.output.width}`
        : ''
      const why = typeof i.note === 'string' && i.retryOf ? ` (${i.note})` : ''
      return `${i.retryOf ? 'Re-render' : 'Render'} ${typeof i.title === 'string' ? `“${i.title}”` : 'a take'}${what}${size}${why}. It uses this computer; nothing is paid.`
    }
    default:
      return `${describeCall(def.command, null, 'running').text}.`
  }
}

/**
 * The approval sentence, with the enhanced prompt for an image generation, so the person sees
 * exactly what will be sent to the provider before paying for it.
 */
async function generateSummary(host: RunHost, def: ToolDef, input: unknown): Promise<string> {
  if (def.command !== 'references.generate') return approvalSummary(def, input)
  const i = input as CommandParsedInput<'references.generate'>
  const brief = await host.ctx.repo.imageBriefs.first(eq(t.imageBrief.id, i.briefId))
  const prompt = (i.prompt ?? brief?.prompt ?? '').trim()
  return `Generate ${i.count} image${i.count === 1 ? '' : 's'} from this prompt: “${prompt.length > 400 ? `${prompt.slice(0, 400)}…` : prompt}” Each is checked before it is kept. This is paid.`
}

/**
 * The inputs of the takes a job has started (not denied), in this run and the runs it carries on
 * from, oldest first. Bounded: a job is carried on a handful of times, not hundreds.
 */
async function jobRenderInputs(
  host: RunHost,
  runId: string,
  job: AiJob,
  steps: StepRow[],
): Promise<unknown[]> {
  const inputs = steps.filter((s) => s.name === 'renders.create' && s.status !== 'denied')
  const out: unknown[] = inputs.map((s) => s.input)
  let next = job.continues
  for (let hops = 0; next && next !== runId && hops < 20; hops++) {
    const earlier = await loadSteps(host.ctx, next)
    out.unshift(
      ...earlier
        .filter((s) => s.name === 'renders.create' && s.status !== 'denied')
        .map((s) => s.input),
    )
    const prev = await host.ctx.repo.runs.first(eq(t.agentRun.id, next))
    next = prev?.job?.continues ?? null
  }
  return out
}

/**
 * Estimated machine time of takes (renders.create inputs). A take that cannot be estimated
 * counts as too long, so it asks rather than slipping through.
 */
async function takesSeconds(host: RunHost, inputs: readonly unknown[]): Promise<number> {
  let total = 0
  for (const raw of inputs) {
    const i = raw as Partial<CommandParsedInput<'renders.create'>>
    try {
      const e = (await host.deps.runtime.execute(
        'renders.estimate',
        {
          pieceId: i.pieceId,
          takes: [{ sceneId: i.sceneId, scene: i.scene }],
          autoTune: i.autoTune ?? false,
          engine: i.engine ?? 'auto',
        },
        host.ctx,
      )) as CommandOutput<'renders.estimate'>
      total += e.seconds
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }
  return total
}

/** What a paid call will cost, when its service can say; null otherwise. */
async function estimateFor(
  host: RunHost,
  job: Job,
): Promise<{ usd: number; seconds: number | null; machine?: boolean } | null> {
  const run = host.deps.runtime
  const ctx = host.forCall(job.call.id)
  try {
    if (job.def.command === 'references.generate') {
      const i = job.input as CommandParsedInput<'references.generate'>
      const brief = await ctx.repo.imageBriefs.first(eq(t.imageBrief.id, i.briefId))
      if (!brief) return null
      const e = (await run.execute(
        'references.estimate',
        { boardId: brief.boardId, count: i.count, provider: brief.provider },
        ctx,
      )) as CommandOutput<'references.estimate'>
      return { usd: e.usd, seconds: e.seconds }
    }
    if (job.def.command === 'renders.create') {
      const i = job.input as CommandParsedInput<'renders.create'>
      const e = (await run.execute(
        'renders.estimate',
        {
          pieceId: i.pieceId,
          takes: [{ sceneId: i.sceneId, scene: i.scene }],
          autoTune: i.autoTune,
          engine: i.engine,
        },
        ctx,
      )) as CommandOutput<'renders.estimate'>
      return { usd: 0, seconds: e.seconds, machine: true }
    }
    if (job.def.command === 'mesh3d.create') {
      const e = (await run.execute('mesh3d.estimate', job.input, ctx)) as {
        usd: number
        seconds?: number
      }
      return { usd: e.usd, seconds: e.seconds ?? null }
    }
  } catch {
    // No estimate is better than a blocked approval.
  }
  return null
}

/**
 * Whether the run must keep waiting: a call still needs a person, or a take it started has not
 * settled. Each take still live is (re)registered, so its settling wakes the run, also after a
 * restart.
 */
async function stillWaiting(host: RunHost): Promise<boolean> {
  const { ctx, runId } = host
  const open = await ctx.repo.steps.many({
    where: and(
      eq(t.agentStep.runId, runId),
      inArray(t.agentStep.status, ['awaiting-approval', 'waiting']),
    )!,
  })
  if (open.some((s) => s.status === 'awaiting-approval')) return true
  let live = false
  for (const s of open) {
    const id = (s.output as { value?: { id?: string } } | null)?.value?.id
    if (!id) continue
    const take = await liveTake(host, id)
    if (take) live = true
  }
  return live
}

const getTake = async (host: RunHost, id: string) =>
  (await host.deps.runtime.execute('renders.get', { id }, host.ctx)) as RenderJob

/**
 * Inside a Render job, one shot is re-rendered at most {@link MAX_RETAKES} times; past that the
 * person reviews it. Returns the refusal, or null.
 */
async function retakeLimit(host: RunHost, input: { retryOf?: string }): Promise<string | null> {
  let depth = 0
  let id = input.retryOf
  while (id && depth <= MAX_RETAKES) {
    depth++
    const row = await host.ctx.repo.renders.first(eq(t.renderJob.id, id))
    id = row?.retryOf ?? undefined
  }
  return depth > MAX_RETAKES
    ? `This shot has been re-rendered ${MAX_RETAKES} times in this job already. Leave it for the designer's review and say what you would change.`
    : null
}

/** The take if it is still rendering (registered for the wake-up), or null once it settled. */
async function liveTake(host: RunHost, id: string): Promise<RenderJob | null> {
  const ctx = host.ctx
  let take = await getTake(host, id)
  take = await expireBrowserTake(ctx, take)
  if (take.status !== 'queued' && take.status !== 'running') return null
  host.deps.waits.register(id, {
    runId: host.runId,
    threadId: host.threadId,
    orgId: ctx.orgId,
    userId: ctx.user.id,
  })
  // Settled between the read and the registration: the event is gone, so look once more.
  const again = await getTake(host, id)
  return again.status === 'queued' || again.status === 'running' ? again : null
}

/**
 * A call waiting on its take: once the take settled, the call is answered with it (and the step
 * completed); while it renders, null.
 */
async function settleWait(host: RunHost, step: StepRow, toolUseId: string) {
  const id = (step.output as { value?: { id?: string } } | null)?.value?.id
  if (!id) return closedResult(toolUseId, 'its take was lost')
  if (await liveTake(host, id)) return null
  const ctx = host.ctx
  const take = await getTake(host, id)
  const piece = await getPiece(ctx, take.pieceId)
  const { result, isError } = await takeResult(ctx, toolUseId, take, piece.version)
  await completeStep(ctx, host.runId, toolUseId, {
    output: { value: take, result } satisfies ToolStepOutput,
    isError,
    ms: Date.now() - step.startedAt.getTime(),
  })
  host.emit({
    type: 'tool.finished',
    toolCallId: toolUseId,
    name: step.name,
    isError,
    changeIds: [],
    assetIds: take.assetIds,
  })
  return result
}

async function runTools(host: RunHost, calls: BetaToolUseBlock[]): Promise<StepOutcome> {
  const { ctx, runId } = host
  const steps = await loadSteps(ctx, runId)
  const byCall = new Map(steps.map((s) => [s.toolCallId, s]))
  let index = await nextIndex(ctx, runId)
  const results = new Map<string, BetaToolResultBlockParam>()
  const queries: Job[] = []
  const mutations: Job[] = []
  let waiting = false
  const run = await ctx.repo.runs.first(eq(t.agentRun.id, runId))
  // Takes a Render job has started so far, over every run of the job (a message carrying the job
  // on does not start a fresh allowance), and the machine time they were estimated at.
  const jobTakes = run?.job ? await jobRenderInputs(host, runId, run.job, steps) : []
  let preapproved = jobTakes.length
  let machineSpent: number | null = null
  const allowances = lastFreeTracker(ctx)

  for (const call of calls) {
    const existing = byCall.get(call.id)
    if (existing?.status === 'waiting') {
      const settled = await settleWait(host, existing, call.id)
      if (settled) results.set(call.id, settled)
      else waiting = true
      continue
    }
    if (existing) {
      const settled = settledResult(existing, call.id)
      if (settled) results.set(call.id, settled)
      else if (existing.status === 'awaiting-approval') waiting = true
      else {
        // Approved (or cut off mid-run by a cancel that never landed): run it now.
        const parsed = parseToolCall(call.name, call.input)
        if (!parsed.ok) results.set(call.id, invalidInputResult(call.id, call.input, parsed.error))
        else mutations.push({ call, def: parsed.def, input: parsed.input, index: existing.idx })
      }
      continue
    }
    const parsed = parseToolCall(call.name, call.input)
    const refuse = async (result: BetaToolResultBlockParam, name: string) => {
      results.set(call.id, result)
      await addStep(ctx, runId, {
        index: index++,
        kind: 'tool',
        name,
        toolCallId: call.id,
        input: call.input,
        output: { value: null, result } satisfies ToolStepOutput,
        isError: true,
        ms: 0,
      })
    }
    if (!parsed.ok) {
      await refuse(
        invalidInputResult(call.id, call.input, parsed.error),
        parsed.command ?? call.name,
      )
      continue
    }
    let admission = admit(parsed.def, ctx.role)
    if (admission.kind === 'refuse') {
      await refuse(errorResult(call.id, admission.message), parsed.command)
      continue
    }
    // A take of a shot that cuts the piece off (or loses it in the frame) wastes machine time:
    // the model fixes the camera first. People render whatever they like.
    if (parsed.command === 'renders.create') {
      const framing = await framingRefusal(
        ctx,
        parsed.input as CommandParsedInput<'renders.create'>,
        host.signal,
      ).catch(() => null)
      if (framing) {
        await refuse(errorResult(call.id, framing), parsed.command)
        continue
      }
    }
    // The last free render or export of the month is the person's to spend, job or not.
    const lastFree = await allowances.spend(parsed.command, parsed.input)
    if (lastFree) admission = { kind: 'approve' }
    else if (
      admission.kind === 'approve' &&
      run?.job &&
      jobApproves(run.job, parsed.command, preapproved)
    ) {
      // Only takes that fit the plan the person saw: within the machine time of its estimate.
      // A bigger, finer or longer take asks, with its own estimate on the card.
      machineSpent ??= await takesSeconds(host, jobTakes)
      const seconds = await takesSeconds(host, [parsed.input])
      if (machineSpent + seconds <= jobMachineBudget(run.job)) {
        admission = { kind: 'run' }
        preapproved++
        machineSpent += seconds
      }
    }
    if (parsed.command === 'renders.create' && run?.job) {
      const retake = await retakeLimit(host, parsed.input as { retryOf?: string })
      if (retake) {
        await refuse(errorResult(call.id, retake), parsed.command)
        continue
      }
    }
    const loop = repeatedFailure(
      { name: parsed.command, input: parsed.input },
      steps.map((s) => ({ name: s.name, input: s.input, isError: s.isError })),
    )
    if (loop) {
      await refuse(errorResult(call.id, loop), parsed.command)
      continue
    }
    const job: Job = { call, def: parsed.def, input: parsed.input, index: index++ }
    if (admission.kind === 'approve') {
      await beginStep(ctx, runId, {
        index: job.index,
        kind: 'tool',
        name: parsed.command,
        toolCallId: call.id,
        input: parsed.input,
        awaitingApproval: true,
      })
      await moveJob(host, parsed.command)
      host.emit({
        type: 'tool.awaiting',
        toolCallId: call.id,
        name: parsed.command,
        input: parsed.input,
        summary: [await generateSummary(host, parsed.def, parsed.input), lastFree]
          .filter(Boolean)
          .join(' '),
        estimate: await estimateFor(host, job),
      })
      waiting = true
      continue
    }
    ;(parsed.def.kind === 'query' ? queries : mutations).push(job)
  }

  // Reads at once, edits one after another in the model's order; all before any suspension.
  const settle = async (job: Job) => {
    const result = await execute(host, job)
    if (result) results.set(job.call.id, result)
    else waiting = true
  }
  await Promise.all(queries.map(settle))
  for (const job of mutations) {
    if (host.signal.aborted) throw host.signal.reason
    await settle(job)
  }
  if (host.signal.aborted) throw host.signal.reason

  if (waiting) {
    const open = await ctx.repo.steps.many({
      where: and(
        eq(t.agentStep.runId, runId),
        inArray(t.agentStep.status, ['awaiting-approval', 'waiting']),
      )!,
    })
    // A decision already landed while the others ran: carry on instead of suspending.
    if (!open.length) return 'continue'
    // A person's go-ahead is asked for first; takes keep rendering meanwhile.
    const suspended = await finishRun(ctx, runId, {
      status: open.some((s) => s.status === 'awaiting-approval') ? 'awaiting-approval' : 'waiting',
    })
    publishRun(ctx, suspended)
    // A take that settled before it was registered sent its event to nobody: look once more.
    if (suspended.status === 'waiting' && !(await stillWaiting(host))) return 'continue'
    return 'suspended'
  }

  const content = calls.map((c) => results.get(c.id) ?? closedResult(c.id, 'it was not run'))
  const message = await addMessage(ctx, {
    threadId: host.threadId,
    runId,
    role: 'user',
    content: content as unknown as Record<string, unknown>[],
  })
  host.emit({ type: 'message.completed', message })
  return 'continue'
}

/**
 * Runs one admitted call and records it; never throws for a tool's own failure. A call that
 * started a take returns null: its step waits, and is answered when the take settles.
 */
async function execute(host: RunHost, job: Job): Promise<BetaToolResultBlockParam | null> {
  const { ctx, runId } = host
  const id = job.call.id
  const command = job.def.command
  const started = Date.now()
  await beginStep(ctx, runId, {
    index: job.index,
    kind: 'tool',
    name: command,
    toolCallId: id,
    input: job.input,
  })
  host.emit({ type: 'tool.started', toolCallId: id, name: command, input: job.input })
  await moveJob(host, command)

  let value: unknown = null
  let result: BetaToolResultBlockParam
  let isError = false
  try {
    const run = await runCommand(host, job)
    value = run.value
    const wait = waitFor(command, run.value)
    if (wait) {
      await completeStep(ctx, runId, id, {
        output: { value, result: null },
        status: 'waiting',
        ms: Date.now() - started,
      })
      host.deps.waits.register(wait.id, {
        runId,
        threadId: host.threadId,
        orgId: ctx.orgId,
        userId: ctx.user.id,
      })
      host.emit({ type: 'tool.waiting', toolCallId: id, name: command, job: wait })
      return null
    }
    result = shapeResult({ toolUseId: id, output: run.value, images: run.images, notes: run.notes })
  } catch (err) {
    if (host.signal.aborted) {
      await recordAppliedBeforeStop(host, job, started)
      throw host.signal.reason
    }
    isError = true
    const message =
      err instanceof AppError
        ? err.message
        : `${command} failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`
    if (!(err instanceof AppError)) console.error(`Assistant tool ${command} failed:`, err)
    result = errorResult(id, message)
    value = err instanceof AppError ? err.toJSON() : { error: message }
  }

  const changeIds = (
    await ctx.repo.changes.many({
      where: and(eq(t.designChange.runId, runId), eq(t.designChange.toolCallId, id)),
      orderBy: asc(t.designChange.seq),
    })
  ).map((c) => c.id)
  await completeStep(ctx, runId, id, {
    output: { value, result } satisfies ToolStepOutput,
    isError,
    ms: Date.now() - started,
    changeIds,
  })
  host.emit({
    type: 'tool.finished',
    toolCallId: id,
    name: command,
    isError,
    changeIds,
    assetIds: assetIdsOf(value),
  })
  return result
}

/**
 * The run was stopped (canceled, paused by a person's edit) while a call was still finishing, for
 * example while the kernel evaluated a change the call had already committed. The change stays,
 * so the call must not go back to the model as "Not run": its step is completed with what is
 * known, and the stop goes on. A call that changed nothing is closed as not run, as before.
 */
async function recordAppliedBeforeStop(host: RunHost, job: Job, started: number): Promise<void> {
  const { ctx, runId } = host
  const id = job.call.id
  const changes = await ctx.repo.changes.many({
    where: and(eq(t.designChange.runId, runId), eq(t.designChange.toolCallId, id)),
    orderBy: asc(t.designChange.seq),
  })
  if (!changes.length) return
  const value = { applied: changes.map((c) => ({ changeId: c.id, label: c.label, seq: c.seq })) }
  const result = shapeResult({
    toolUseId: id,
    output: value,
    notes: [
      'Applied. The run was stopped before the evaluation of this change came back, so read the piece again before relying on its numbers.',
    ],
  })
  const changeIds = changes.map((c) => c.id)
  await completeStep(ctx, runId, id, {
    output: { value, result } satisfies ToolStepOutput,
    isError: false,
    ms: Date.now() - started,
    changeIds,
  })
  host.emit({
    type: 'tool.finished',
    toolCallId: id,
    name: job.def.command,
    isError: false,
    changeIds,
    assetIds: [],
  })
}

function assetIdsOf(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const v = value as {
    images?: { assetId?: unknown }[]
    shots?: { assetId?: unknown }[]
    asset?: { id?: unknown }
  }
  // Captures (viewport.capture's images, scenes.capture's shots) show in the conversation.
  const ids = [...(v.images ?? []), ...(v.shots ?? [])]
    .map((i) => i.assetId)
    .filter((x): x is string => typeof x === 'string')
  if (typeof v.asset?.id === 'string') ids.push(v.asset.id)
  return ids
}

interface CommandRun {
  value: unknown
  images?: ShapeImage[]
  notes?: string[]
}

/** Commands that make their own Claude call: inside a run they use the run's client and tier. */
const CLAUDE_COMMANDS = new Set<string>(['references.brief', 'references.generate'])

/** The run's Claude client for a command's own structured call, billed to the run. */
function claudeOfRun(host: RunHost, job: Job): ClaudeCall {
  return {
    client: host.client,
    model: host.model as AssistantModelId,
    key: `${host.runId}:${job.call.id}`,
    runId: host.runId,
    spent: async (tokens, costUsd) => {
      await addUsage(host.ctx, host.runId, { tokens, costUsd })
      host.emit({ type: 'usage', tokens, costUsd })
    },
  }
}

async function runCommand(host: RunHost, job: Job): Promise<CommandRun> {
  const base = host.forCall(job.call.id)
  const ctx: Ctx = CLAUDE_COMMANDS.has(job.def.command)
    ? { ...base, claude: claudeOfRun(host, job) }
    : base
  const input = job.input as Record<string, unknown>
  if (job.def.client) return runClientTool(host, job, ctx)
  const command = job.def.command as CommandName
  if (command === 'references.read') return readInRun(host, job, ctx)
  if (command === 'chat.ask') return answerOf(host, job)
  const notes: string[] = []
  let callInput: unknown = job.input
  if (command === 'design.apply') {
    const overlap = await overlapFor(host, input.pieceId as string, input.ops as never[])
    if (overlap.kind === 'conflict') throw new AppError('conflict', overlap.message)
    if (overlap.notes) notes.push(overlap.notes)
    // A retried call commits the same change once.
    callInput = { ...input, changeId: input.changeId ?? `chg_${host.runId}_${job.call.id}` }
  }
  const value = await host.deps.runtime.execute(command, callInput, ctx)
  await afterCommand(host, command, input, value, notes)
  if (command === 'scenes.capture')
    return { value, notes, images: await shotImages(ctx, value as CommandOutput<'scenes.capture'>) }
  return { value, notes }
}

/**
 * A client tool, asked of the designer's windows. A capture no window can draw (none open, none
 * showing that piece, none answering) is drawn on the server instead, and says so.
 */
async function runClientTool(host: RunHost, job: Job, ctx: Ctx): Promise<CommandRun> {
  const tool = job.def.command as ClientToolName
  const capture = tool === 'viewport.capture'
  const pieceId = capture ? (job.input as { pieceId: string }).pieceId : null
  // The window waits for the version just committed, so it draws the edit the model just made.
  const atVersion = pieceId ? (await getPiece(ctx, pieceId)).version : null
  const ask = (clientId: string | null) =>
    host.deps.bridge.request(ctx, {
      runId: host.runId,
      clientId,
      tool,
      input: job.input,
      signal: host.signal,
      ...(capture ? { atVersion } : {}),
    })
  try {
    let value: unknown
    try {
      value = await ask(host.clientId)
    } catch (err) {
      // The window the message came from cannot (that piece is not open there): ask them all.
      if (host.signal.aborted || !(err instanceof NoWindow) || !host.clientId) throw err
      value = await ask(null)
    }
    return { value, images: await captureImages(ctx, value) }
  } catch (err) {
    if (host.signal.aborted) throw host.signal.reason
    if (!capture || !(err instanceof NoWindow)) throw err
    const value = await captureOnServer(
      ctx,
      job.input as ClientToolParsedInput<'viewport.capture'>,
      host.signal,
    )
    return {
      value,
      images: await captureImages(ctx, value),
      notes: [
        `${err.message} These pictures were drawn on the server instead: plain shaded clay (metal grey, stones pale blue), no materials or labels.`,
      ],
    }
  }
}

/**
 * A question the person answered: their picks (stored with the approval) made whole, every
 * question they left alone taking its defaults.
 */
async function answerOf(host: RunHost, job: Job): Promise<CommandRun> {
  const step = await host.ctx.repo.steps.first(
    and(eq(t.agentStep.runId, host.runId), eq(t.agentStep.toolCallId, job.call.id))!,
  )
  const { questions } = job.input as CommandParsedInput<'chat.ask'>
  const value = resolveAnswers(questions, step?.approval?.answers)
  const said = value.answers
    .map(
      (a) =>
        `${a.question} ${a.chosen.map((c) => c.label).join(', ')}${a.default ? ' (your default)' : ''}`,
    )
    .join(' · ')
  const note = step?.approval?.note ? ` Their note: ${step.approval.note}` : ''
  // In a job, the answers join its plan, so the person sees what was settled under the step.
  await changeJob(host, (j) => recordAnswers(j, value))
  return {
    value,
    notes: [`The designer answered: ${said}.${note} Say in one line what you will do, then do it.`],
  }
}

/** The photo read, on the run's own client and tier, billed to the run. */
async function readInRun(host: RunHost, job: Job, ctx: Ctx): Promise<CommandRun> {
  const { output } = await readPhotos({
    ctx,
    client: host.client,
    model: host.model as AssistantModelId,
    input: job.input as CommandParsedInput<'references.read'>,
    signal: host.signal,
    usage: {
      key: `${host.runId}:${job.call.id}:read`,
      runId: host.runId,
      pieceId: host.pieceId,
      stage: host.stage,
    },
    spent: async (usage) => {
      await addUsage(host.ctx, host.runId, usage)
      host.emit({ type: 'usage', tokens: usage.tokens, costUsd: usage.costUsd })
    },
  })
  return { value: output }
}

/** Bookkeeping and the notes the prompt promises after particular tools. */
async function afterCommand(
  host: RunHost,
  command: CommandName,
  input: Record<string, unknown>,
  value: unknown,
  notes: string[],
): Promise<void> {
  const out = value as Record<string, unknown> | null
  // Versions the model has now seen, for the overlap check.
  if (command === 'pieces.get' || command === 'pieces.create') {
    const p = out as { id: string; version: number }
    host.seen.set(p.id, p.version)
  }
  if (
    (command === 'design.apply' || command === 'design.revert') &&
    typeof out?.version === 'number'
  )
    host.seen.set(input.pieceId as string, out.version)
  if (command === 'pieces.buildFromSpec' && typeof out?.version === 'number') {
    host.seen.set(input.id as string, out.version)
    // Take to CAD: the picture the build came from lies in its view, scaled to the build.
    // The read is found in the run's steps: an approval between the read and the build ends
    // the session that made the read, so nothing in memory survives until here.
    const read = await lastReadOf(host.ctx, host.runId)
    if (read) {
      try {
        const note = await placeTakePlane(host.ctx, input.id as string, read, host.signal)
        if (note) notes.push(note)
      } catch (err) {
        if (host.signal.aborted) throw err
        console.error('Placing the picture in its view failed:', err)
      }
    }
  }

  if (command === 'pieces.create') await bindPiece(host, (out as { id: string }).id)
  if ((command === 'pieces.setSpec' || command === 'pieces.create') && input.spec) {
    const canon = canonText({ spec: input.spec as never })
    if (canon) notes.push(canon)
  }
  if (command === 'design.apply') {
    const note = await evaluationFor(host, input.pieceId as string)
    if (note) notes.push(note)
  }
  if (
    command === 'scenes.list' ||
    command === 'scenes.create' ||
    command === 'scenes.update' ||
    command === 'scenes.revert'
  ) {
    const shots = (
      command === 'scenes.list'
        ? out
        : command === 'scenes.revert'
          ? [(out as { scene: SavedScene }).scene]
          : [out]
    ) as SavedScene[]
    const note = await cameraNote(host.ctx, shots[0]?.pieceId ?? null, shots, host.signal)
    if (note) notes.push(note)
  }
  // The checks the CAD job runs are the kernel's diagnostics (in the result) and the canon's
  // style findings, which only the loop adds.
  if (command === 'design.evaluate') {
    const piece = await getPiece(host.ctx, input.pieceId as string)
    const summary = out as EvaluationSummary | null
    notes.push(styleFindings(piece.design, summary) ?? 'Canon style findings: none.')
    if (summary) {
      // The CAD job confirms cost along with weight and carats; this is the estimate the
      // production package uses, at its placeholder rates until the house sets its own.
      try {
        const cost = roughCost(summary).perPiece.cost
        if (cost > 0)
          notes.push(
            `Rough cost to make: about $${Math.round(cost)} (metal, stones, setting, labour and overhead at placeholder rates; not a quote).`,
          )
      } catch {
        // A summary the estimate cannot price: leave the cost out rather than guess.
      }
    }
  }
}

/** The canon's findings as a note; null when there are none (or the canon cannot read it). */
function styleFindings(design: Design, summary: EvaluationSummary | null): string | null {
  let findings: ReturnType<typeof lintDesign> = []
  try {
    findings = lintDesign(design, summary ?? undefined)
  } catch {
    return null
  }
  if (!findings.length) return null
  return [
    'Canon style findings:',
    ...findings.map(
      (f) =>
        `- ${f.level} ${f.code}${f.nodeId ? ` [${f.nodeId}]` : ''}: ${f.message}${f.fix ? ` (fix: ${f.fix.label})` : ''}`,
    ),
  ].join('\n')
}

/** A run that creates a piece works on it from then on; the thread follows if it had none. */
async function bindPiece(host: RunHost, pieceId: string): Promise<void> {
  host.pieceId = host.pieceId ?? pieceId
  await host.ctx.repo.runs.update(and(eq(t.agentRun.id, host.runId), isNull(t.agentRun.pieceId))!, {
    pieceId,
  })
  await host.ctx.repo.threads.update(
    and(eq(t.thread.id, host.threadId), isNull(t.thread.pieceId))!,
    { pieceId },
  )
}

/** The facts and canon style findings after an edit; the kernel may be absent (tests, setup). */
async function evaluationFor(host: RunHost, pieceId: string): Promise<string | null> {
  const ctx = host.ctx
  const piece = await getPiece(ctx, pieceId)
  let summary: EvaluationSummary | undefined
  try {
    summary = await ctx.services
      .get('geometry')
      .evaluate(
        piece.design,
        { detail: 'draft', pieceId, signal: host.signal },
        serviceContext(ctx),
      )
  } catch {
    // No kernel here (or it failed): the model still gets the canon's findings.
    if (host.signal.aborted) throw host.signal.reason
    summary = undefined
  }
  if (!summary) return styleFindings(piece.design, null)
  let findings: ReturnType<typeof lintDesign> = []
  try {
    findings = lintDesign(piece.design, summary)
  } catch {
    findings = []
  }
  return evaluationNote(summary, findings)
}

/**
 * People's changes to the piece since the model last saw it, checked against its ops. Without a
 * known version (a fresh session that has not read the piece) the run's own last change, else
 * the version shown with the message, stands in.
 */
async function overlapFor(host: RunHost, pieceId: string, ops: { t: string; id?: string }[]) {
  const ctx = host.ctx
  let seen = host.seen.get(pieceId)
  if (seen === undefined) {
    const [mine] = await ctx.repo.changes.select(
      { seq: max(t.designChange.seq) },
      and(eq(t.designChange.pieceId, pieceId), eq(t.designChange.runId, host.runId)),
    )
    const run = await ctx.repo.runs.first(eq(t.agentRun.id, host.runId))
    const base = run?.pieceId === pieceId ? run.baseSeq : null
    const known = [mine?.seq, base].filter((x): x is number => typeof x === 'number')
    if (!known.length) return checkOverlap(ops, [])
    seen = Math.max(...known)
  }
  const since = await ctx.repo.changes.many({
    where: and(
      eq(t.designChange.pieceId, pieceId),
      gt(t.designChange.seq, seen),
      or(isNull(t.designChange.runId), ne(t.designChange.runId, host.runId)),
    ),
    orderBy: asc(t.designChange.seq),
  })
  const result = checkOverlap(
    ops,
    since.map((c) => ({ seq: c.seq, label: c.label, ops: c.ops })),
  )
  // Told once: the model re-plans on top of what it is now shown.
  const latest = since.at(-1)?.seq
  if (latest !== undefined && result.kind === 'conflict') host.seen.set(pieceId, latest)
  return result
}

/** The views a capture returned, as images for the model. */
/** Each shot's look through its own camera, labelled with its framing, for the model to see. */
async function shotImages(ctx: Ctx, value: CommandOutput<'scenes.capture'>): Promise<ShapeImage[]> {
  const out: ShapeImage[] = []
  for (const shot of value.shots) {
    if (!shot.assetId) continue
    // The shot reference goes just before the capture, so the pair reads side by side.
    if (shot.referenceAssetId) {
      const ref = await readAsset(ctx, shot.referenceAssetId)
      const picture = await modelImage(ref.bytes, ref.asset.mime)
      if (picture) out.push({ label: `Shot reference for “${shot.title}”`, ...picture })
    }
    const { asset, bytes } = await readAsset(ctx, shot.assetId)
    const resized = await modelImage(bytes, asset.mime)
    if (!resized) continue
    const verdict = shot.ok ? 'framing ok' : `framing problem: ${shot.problem}`
    out.push({
      label: `Shot “${shot.title}” (${shot.id}), ${shot.framing}, ${verdict}`,
      ...resized,
    })
  }
  return out
}

async function captureImages(ctx: Ctx, value: unknown): Promise<ShapeImage[]> {
  const v = value as { version?: number; images?: { view: unknown; assetId: string }[] } | null
  if (!v?.images?.length) return []
  const out: ShapeImage[] = []
  for (const img of v.images) {
    const { asset, bytes } = await readAsset(ctx, img.assetId)
    const resized = await modelImage(bytes, asset.mime)
    if (!resized) continue
    const view = typeof img.view === 'string' ? img.view : JSON.stringify(img.view)
    out.push({ label: `${view} view, design version ${v.version ?? '?'}`, ...resized })
  }
  return out
}
