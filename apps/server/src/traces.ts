/**
 * The trace store: threads, runs, steps, messages and feedback, written by the assistant runtime
 * and read by the `threads.*` and `traces.*` commands. Postgres is the system of record for
 * traces; every write here is safe to repeat where the loop may resume (messages by
 * `clientMessageId`, tool steps by `toolCallId`).
 */
import type { Feedback, Message, Run, Step, Thread, Tokens } from '@pave/schema'
import { and, eq, max, sql } from 'drizzle-orm'
import type { Ctx } from './context'
import * as t from './db/schema'
import { conflict, notFound } from './errors'
import { createId } from './ids'
import { ensure, getBoard, getPiece, getRun, getScene, getThread } from './lookups'
import { fromMicros, toMicros } from './usage'

type RunStatus = Run['status']

export const toThread = (r: typeof t.thread.$inferSelect): Thread => ({
  id: r.id,
  title: r.title,
  context: { pieceId: r.pieceId, boardId: r.boardId, sceneId: r.sceneId },
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

export const toMessage = (r: typeof t.agentMessage.$inferSelect): Message => ({
  id: r.id,
  threadId: r.threadId,
  seq: r.seq,
  role: r.role,
  content: r.content,
  runId: r.runId,
  createdAt: r.createdAt.toISOString(),
})

export const toRun = (r: typeof t.agentRun.$inferSelect): Run => ({
  id: r.id,
  threadId: r.threadId,
  pieceId: r.pieceId,
  userId: r.userId,
  model: r.model,
  origin: r.origin,
  status: r.status,
  tokens: {
    input: r.tokensIn,
    output: r.tokensOut,
    cacheRead: r.tokensCacheRead,
    cacheWrite: r.tokensCacheWrite,
  },
  costUsd: fromMicros(r.costMicros),
  startedAt: r.startedAt.toISOString(),
  endedAt: r.endedAt?.toISOString() ?? null,
  error: r.error,
  errorCode: r.errorCode,
})

export const toStep = (r: typeof t.agentStep.$inferSelect): Step => ({
  id: r.id,
  runId: r.runId,
  index: r.idx,
  kind: r.kind,
  name: r.name,
  toolCallId: r.toolCallId,
  status: r.status,
  input: r.input,
  output: r.output,
  isError: r.isError,
  ms: r.ms,
  approval: r.approval ?? null,
  usage: r.usage ?? null,
  stopReason: r.stopReason,
  changeIds: r.changeIds,
  startedAt: r.startedAt.toISOString(),
})

export const toFeedback = (r: typeof t.runFeedback.$inferSelect): Feedback => ({
  id: r.id,
  runId: r.runId,
  stepId: r.stepId,
  source: r.source,
  kind: r.kind,
  changeId: r.changeId,
  detail: r.note ?? '',
  userId: r.userId,
  at: r.createdAt.toISOString(),
})

export async function createThread(
  ctx: Ctx,
  input: {
    title: string
    pieceId?: string | null
    boardId?: string | null
    sceneId?: string | null
    /** Hash of the frozen system prompt and tools the thread is started with. */
    promptHash?: string | null
  },
): Promise<Thread> {
  await ensure(getPiece, ctx, input.pieceId)
  await ensure(getBoard, ctx, input.boardId)
  await ensure(getScene, ctx, input.sceneId)
  const row = await ctx.repo.threads.insert({
    id: createId('th'),
    userId: ctx.user.id,
    title: input.title,
    pieceId: input.pieceId ?? null,
    boardId: input.boardId ?? null,
    sceneId: input.sceneId ?? null,
    promptHash: input.promptHash ?? null,
  })
  return toThread(row)
}

export async function startRun(
  ctx: Ctx,
  input: {
    model: string
    threadId?: string | null
    pieceId?: string | null
    parentRunId?: string | null
    /** Design version the model is shown, so the run can be replayed against it. */
    baseSeq?: number | null
    origin?: Run['origin']
  },
): Promise<Run> {
  await ensure(getThread, ctx, input.threadId)
  await ensure(getPiece, ctx, input.pieceId)
  await ensure(getRun, ctx, input.parentRunId)
  const row = await ctx.repo.runs.insert({
    id: createId('run'),
    userId: ctx.user.id,
    model: input.model,
    origin: input.origin ?? 'studio',
    status: 'running',
    threadId: input.threadId ?? null,
    pieceId: input.pieceId ?? null,
    parentRunId: input.parentRunId ?? null,
    baseSeq: input.baseSeq ?? null,
  })
  return toRun(row)
}

interface StepStart {
  /** Position in the run, assigned by the runtime (steps may finish out of order). */
  index: number
  kind: Step['kind']
  name: string
  toolCallId?: string | null
  input: unknown
  startedAt?: Date
}

interface StepResult {
  output: unknown
  isError?: boolean
  status?: Step['status']
  ms: number
  /** Ids of the design changes this step made (from `design.apply` results). */
  changeIds?: string[]
  usage?: Step['usage']
  stopReason?: string | null
}

/** Records a finished step in one write (model calls; tool calls that need no resume). */
export async function addStep(ctx: Ctx, runId: string, input: StepStart & StepResult): Promise<Step> {
  await getRun(ctx, runId)
  const row = await ctx.repo.steps.insert({
    id: createId('stp'),
    runId,
    idx: input.index,
    kind: input.kind,
    name: input.name,
    toolCallId: input.toolCallId ?? null,
    status: input.status ?? (input.isError ? 'failed' : 'done'),
    input: input.input,
    output: input.output,
    isError: input.isError ?? false,
    ms: Math.round(input.ms),
    changeIds: input.changeIds ?? [],
    usage: input.usage ?? null,
    stopReason: input.stopReason ?? null,
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
  })
  return toStep(row)
}

/**
 * Opens a tool step before the call runs; with `awaitingApproval` it waits for `decideStep`.
 * Idempotent on `(runId, toolCallId)`: beginning the same call again returns the existing step.
 */
export async function beginStep(
  ctx: Ctx,
  runId: string,
  input: StepStart & { toolCallId: string; awaitingApproval?: boolean },
): Promise<Step> {
  await getRun(ctx, runId)
  const now = new Date()
  await ctx.repo.steps.insertIfAbsent({
    id: createId('stp'),
    runId,
    idx: input.index,
    kind: input.kind,
    name: input.name,
    toolCallId: input.toolCallId,
    status: input.awaitingApproval ? 'awaiting-approval' : 'running',
    input: input.input,
    approval: input.awaitingApproval
      ? { requestedAt: now.toISOString(), decision: null, decidedBy: null, decidedAt: null, note: null }
      : null,
    startedAt: input.startedAt ?? now,
  })
  const row = await ctx.repo.steps.first(
    and(eq(t.agentStep.runId, runId), eq(t.agentStep.toolCallId, input.toolCallId)),
  )
  if (!row) throw conflict(`Step ${input.index} of run "${runId}" is already another tool call`)
  return toStep(row)
}

/** Closes a tool step opened with {@link beginStep}. */
export async function completeStep(
  ctx: Ctx,
  runId: string,
  toolCallId: string,
  result: StepResult,
): Promise<Step> {
  const [row] = await ctx.repo.steps.update(
    and(eq(t.agentStep.runId, runId), eq(t.agentStep.toolCallId, toolCallId))!,
    {
      output: result.output,
      isError: result.isError ?? false,
      status: result.status ?? (result.isError ? 'failed' : 'done'),
      ms: Math.round(result.ms),
      changeIds: result.changeIds ?? [],
      ...(result.usage !== undefined ? { usage: result.usage } : {}),
      ...(result.stopReason !== undefined ? { stopReason: result.stopReason } : {}),
    },
  )
  if (!row) throw notFound(`Tool call "${toolCallId}" of run`, runId)
  return toStep(row)
}

/**
 * Records a person's answer to a step awaiting approval. The first answer wins; a second one,
 * or one for a step that is not waiting, is a conflict.
 */
export async function decideStep(
  ctx: Ctx,
  runId: string,
  toolCallId: string,
  input: { decision: 'approve' | 'deny'; note?: string | null },
): Promise<Step> {
  const step = await ctx.repo.steps.first(
    and(eq(t.agentStep.runId, runId), eq(t.agentStep.toolCallId, toolCallId)),
  )
  if (!step) throw notFound(`Tool call "${toolCallId}" of run`, runId)
  if (step.status !== 'awaiting-approval' || !step.approval)
    throw conflict('This tool call is not waiting for approval')
  const [row] = await ctx.repo.steps.update(
    and(eq(t.agentStep.id, step.id), eq(t.agentStep.status, 'awaiting-approval'))!,
    {
      status: input.decision === 'approve' ? 'running' : 'denied',
      approval: {
        ...step.approval,
        decision: input.decision,
        decidedBy: ctx.user.id,
        decidedAt: new Date().toISOString(),
        note: input.note ?? null,
      },
    },
  )
  if (!row) throw conflict('This tool call was answered already')
  return toStep(row)
}

/** Adds one model call's tokens and cost to the run's totals, atomically. */
export async function addUsage(
  ctx: Ctx,
  runId: string,
  usage: { tokens: Tokens; costUsd: number },
): Promise<Run> {
  const r = t.agentRun
  const [row] = await ctx.repo.runs.update(eq(r.id, runId), {
    tokensIn: sql`${r.tokensIn} + ${usage.tokens.input}`,
    tokensOut: sql`${r.tokensOut} + ${usage.tokens.output}`,
    tokensCacheRead: sql`${r.tokensCacheRead} + ${usage.tokens.cacheRead}`,
    tokensCacheWrite: sql`${r.tokensCacheWrite} + ${usage.tokens.cacheWrite}`,
    costMicros: sql`${r.costMicros} + ${toMicros(usage.costUsd)}`,
  })
  if (!row) throw notFound('Run', runId)
  return toRun(row)
}

/**
 * Appends a verbatim message (provider-native content blocks) to a thread as its next `seq`.
 * With `clientMessageId`, storing the same message again returns the first copy.
 */
export async function addMessage(
  ctx: Ctx,
  input: {
    threadId: string
    runId?: string | null
    role: Message['role']
    content: Message['content']
    clientMessageId?: string | null
  },
): Promise<Message> {
  await ensure(getRun, ctx, input.runId)
  return ctx.repo.transaction(async (tx) => {
    // Updating the thread row first also serialises concurrent appends to it.
    const [thread] = await tx.threads.update(eq(t.thread.id, input.threadId), {
      updatedAt: new Date(),
    })
    if (!thread) throw notFound('Thread', input.threadId)
    if (input.clientMessageId) {
      const existing = await tx.messages.first(
        eq(t.agentMessage.clientMessageId, input.clientMessageId),
      )
      if (existing) return toMessage(existing)
    }
    const [last] = await tx.messages.select(
      { seq: max(t.agentMessage.seq) },
      eq(t.agentMessage.threadId, input.threadId),
    )
    const row = await tx.messages.insert({
      id: createId('msg'),
      threadId: input.threadId,
      runId: input.runId ?? null,
      seq: (last?.seq ?? 0) + 1,
      role: input.role,
      content: input.content,
      clientMessageId: input.clientMessageId ?? null,
    })
    return toMessage(row)
  })
}

export async function finishRun(
  ctx: Ctx,
  runId: string,
  input: {
    status: Exclude<RunStatus, 'running'>
    tokens?: Tokens
    costUsd?: number
    error?: string | null
    errorCode?: Run['errorCode']
  },
): Promise<Run> {
  const [row] = await ctx.repo.runs.update(eq(t.agentRun.id, runId), {
    status: input.status,
    error: input.error ?? null,
    errorCode: input.errorCode ?? null,
    endedAt: input.status === 'awaiting-approval' ? null : new Date(),
    ...(input.tokens
      ? {
          tokensIn: input.tokens.input,
          tokensOut: input.tokens.output,
          tokensCacheRead: input.tokens.cacheRead,
          tokensCacheWrite: input.tokens.cacheWrite,
        }
      : {}),
    ...(input.costUsd !== undefined ? { costMicros: toMicros(input.costUsd) } : {}),
  })
  if (!row) throw notFound('Run', runId)
  return toRun(row)
}

export const traces = {
  createThread,
  startRun,
  addStep,
  beginStep,
  completeStep,
  decideStep,
  addUsage,
  addMessage,
  finishRun,
}
