/**
 * The trace store: threads, runs, steps and messages, written by the assistant runtime and read
 * by the `threads.*` and `traces.*` commands. Postgres is the system of record for traces.
 */
import type { Message, Run, Step, Thread } from '@pave/schema'
import { eq } from 'drizzle-orm'
import type { Ctx } from './context'
import * as t from './db/schema'
import { notFound } from './errors'
import { createId } from './ids'
import { fromMicros, toMicros } from './usage'

type RunStatus = Run['status']
type Tokens = Run['tokens']

export const toThread = (r: typeof t.thread.$inferSelect): Thread => ({
  id: r.id,
  title: r.title,
  context: { pieceId: r.pieceId, boardId: r.boardId },
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

export const toMessage = (r: typeof t.agentMessage.$inferSelect): Message => ({
  id: r.id,
  threadId: r.threadId,
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
  status: r.status,
  tokens: { input: r.tokensIn, output: r.tokensOut, cacheRead: r.tokensCacheRead, cacheWrite: r.tokensCacheWrite },
  costUsd: fromMicros(r.costMicros),
  startedAt: r.startedAt.toISOString(),
  endedAt: r.endedAt?.toISOString() ?? null,
  error: r.error,
})

export const toStep = (r: typeof t.agentStep.$inferSelect): Step => ({
  id: r.id,
  runId: r.runId,
  index: r.idx,
  kind: r.kind,
  name: r.name,
  input: r.input,
  output: r.output,
  isError: r.isError,
  ms: r.ms,
  changeIds: r.changeIds,
  startedAt: r.startedAt.toISOString(),
})

export async function createThread(
  ctx: Ctx,
  input: { title: string; pieceId?: string | null; boardId?: string | null },
): Promise<Thread> {
  const row = await ctx.repo.threads.insert({
    id: createId('th'),
    userId: ctx.user.id,
    title: input.title,
    pieceId: input.pieceId ?? null,
    boardId: input.boardId ?? null,
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
  },
): Promise<Run> {
  const row = await ctx.repo.runs.insert({
    id: createId('run'),
    userId: ctx.user.id,
    model: input.model,
    status: 'running',
    threadId: input.threadId ?? null,
    pieceId: input.pieceId ?? null,
    parentRunId: input.parentRunId ?? null,
    baseSeq: input.baseSeq ?? null,
  })
  return toRun(row)
}

export async function addStep(
  ctx: Ctx,
  runId: string,
  input: {
    /** Position in the run, assigned by the runtime (steps may finish out of order). */
    index: number
    kind: Step['kind']
    name: string
    toolCallId?: string | null
    input: unknown
    output: unknown
    isError?: boolean
    ms: number
    /** Ids of the design changes this step made (from `design.apply` results). */
    changeIds?: string[]
    startedAt?: Date
  },
): Promise<Step> {
  const row = await ctx.repo.steps.insert({
    id: createId('stp'),
    runId,
    idx: input.index,
    kind: input.kind,
    name: input.name,
    toolCallId: input.toolCallId ?? null,
    input: input.input,
    output: input.output,
    isError: input.isError ?? false,
    ms: Math.round(input.ms),
    changeIds: input.changeIds ?? [],
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
  })
  return toStep(row)
}

/** Appends a verbatim message (provider-native content blocks) to a thread. */
export async function addMessage(
  ctx: Ctx,
  input: { threadId: string; runId?: string | null; role: Message['role']; content: Message['content'] },
): Promise<Message> {
  return ctx.repo.transaction(async (tx) => {
    const [thread] = await tx.threads.update(eq(t.thread.id, input.threadId), { updatedAt: new Date() })
    if (!thread) throw notFound('Thread', input.threadId)
    const row = await tx.messages.insert({
      id: createId('msg'),
      threadId: input.threadId,
      runId: input.runId ?? null,
      role: input.role,
      content: input.content,
    })
    return toMessage(row)
  })
}

export async function finishRun(
  ctx: Ctx,
  runId: string,
  input: { status: Exclude<RunStatus, 'running'>; tokens?: Tokens; costUsd?: number; error?: string | null },
): Promise<Run> {
  const [row] = await ctx.repo.runs.update(eq(t.agentRun.id, runId), {
    status: input.status,
    error: input.error ?? null,
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

export const traces = { createThread, startRun, addStep, addMessage, finishRun }
