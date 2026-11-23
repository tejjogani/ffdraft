import { and, asc, desc, eq } from 'drizzle-orm'
import * as t from '../db/schema'
import { notFound } from '../errors'
import { createId } from '../ids'
import { getRun, getThread } from '../lookups'
import { toMessage, toRun, toStep, toThread } from '../traces'
import type { HandlerGroup } from './types'

export const assistant: HandlerGroup<'threads' | 'traces'> = {
  'threads.list': async (ctx, input) => {
    const rows = await ctx.repo.threads.many({
      where: input.pieceId ? eq(t.thread.pieceId, input.pieceId) : undefined,
      orderBy: desc(t.thread.updatedAt),
      limit: input.limit,
    })
    return rows.map(toThread)
  },

  'threads.get': async (ctx, { id }) => {
    const thread = await getThread(ctx, id)
    const messages = await ctx.repo.messages.many({
      where: eq(t.agentMessage.threadId, id),
      orderBy: [asc(t.agentMessage.createdAt), asc(t.agentMessage.id)],
    })
    return { thread: toThread(thread), messages: messages.map(toMessage) }
  },

  'threads.delete': async (ctx, { id }) => {
    await getThread(ctx, id)
    await ctx.repo.threads.delete(eq(t.thread.id, id))
    return { ok: true }
  },

  'traces.runs': async (ctx, input) => {
    const rows = await ctx.repo.runs.many({
      where: input.pieceId ? eq(t.agentRun.pieceId, input.pieceId) : undefined,
      orderBy: desc(t.agentRun.startedAt),
      limit: input.limit,
    })
    return rows.map(toRun)
  },

  'traces.run': async (ctx, { id }) => {
    const run = await getRun(ctx, id)
    const steps = await ctx.repo.steps.many({
      where: eq(t.agentStep.runId, id),
      orderBy: asc(t.agentStep.idx),
    })
    return { run: toRun(run), steps: steps.map(toStep) }
  },

  'traces.feedback': async (ctx, input) => {
    await getRun(ctx, input.runId)
    if (input.stepId) {
      const step = await ctx.repo.steps.first(
        and(eq(t.agentStep.id, input.stepId), eq(t.agentStep.runId, input.runId)),
      )
      if (!step) throw notFound('Step', input.stepId)
    }
    await ctx.repo.feedback.insert({
      id: createId('fb'),
      runId: input.runId,
      stepId: input.stepId ?? null,
      rating: input.rating,
      note: input.note ?? null,
      userId: ctx.user.id,
    })
    return { ok: true }
  },
}
