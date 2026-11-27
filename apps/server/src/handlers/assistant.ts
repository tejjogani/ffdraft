import { type Message, roleAllows } from '@pave/schema'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { badRequest, forbidden, notFound } from '../errors'
import { createId } from '../ids'
import { ensure, ensureAll, getBoard, getPiece, getRun, getScene, getThread } from '../lookups'
import { serviceContext } from '../service-context'
import { toFeedback, toMessage, toRun, toStep, toThread } from '../traces'
import type { HandlerGroup } from './types'

/** Conversations are private to the person having them; another member's is not found. */
async function ownThread(ctx: Ctx, id: string) {
  const thread = await getThread(ctx, id)
  if (thread.userId !== ctx.user.id) throw notFound('Thread', id)
  return thread
}

/**
 * Traces carry the conversation (model inputs and outputs), so they share its privacy: a member
 * reads their own runs; admins and owners, who answer for the organisation's use, read any.
 */
const seesAllRuns = (ctx: Ctx) => roleAllows(ctx.role, 'admin')

async function readableRun(ctx: Ctx, id: string) {
  const run = await getRun(ctx, id)
  if (run.userId !== ctx.user.id && !seesAllRuns(ctx)) throw notFound('Run', id)
  return run
}

/**
 * A message as the studio reads it: photos sent to the model are stored inline (the model must
 * get the same bytes on every turn), but the studio shows them from their assets, so their data
 * is left out here to keep the conversation light.
 */
function forStudio(m: Message): Message {
  if (!m.content.some((b) => b.type === 'image')) return m
  return {
    ...m,
    content: m.content.map((b) => {
      const source = b.source as { type?: string; media_type?: string } | undefined
      return b.type === 'image' && source?.type === 'base64'
        ? { ...b, source: { type: 'base64', media_type: source.media_type, data: '' } }
        : b
    }),
  }
}

/** Runs are steered (approved, stopped) only by the person they act for. */
async function ownRun(ctx: Ctx, id: string) {
  const run = await getRun(ctx, id)
  if (run.userId !== ctx.user.id) throw notFound('Run', id)
  return run
}

export const assistant: HandlerGroup<
  'threads' | 'runs' | 'client' | 'traces' | 'assistant' | 'chat'
> = {
  // Inside a run the loop answers it with what the person picked; on its own it has nobody to ask.
  'chat.ask': async () => {
    throw badRequest(
      'chat.ask asks the designer inside an assistant conversation; there is no one to answer it here.',
    )
  },
  // Setup works without a key (that is how one is entered); the key itself never comes back.
  'assistant.setup.get': async (ctx) =>
    ctx.services
      .get('assistantSetup')
      .get(serviceContext(ctx), { admin: roleAllows(ctx.role, 'admin') }),

  'assistant.key.set': async (ctx, { apiKey }) => {
    if (ctx.actor.type !== 'user') throw forbidden('Only a person can set the API key')
    return ctx.services.get('assistantSetup').setKey(apiKey, serviceContext(ctx))
  },

  'assistant.key.test': async (ctx, { apiKey }) =>
    ctx.services.get('assistantSetup').testKey(apiKey ?? null, serviceContext(ctx)),

  'assistant.key.remove': async (ctx) => {
    if (ctx.actor.type !== 'user') throw forbidden('Only a person can remove the API key')
    return ctx.services.get('assistantSetup').removeKey(serviceContext(ctx))
  },

  'threads.list': async (ctx, input) => {
    const rows = await ctx.repo.threads.many({
      where: and(
        eq(t.thread.userId, ctx.user.id),
        input.pieceId ? eq(t.thread.pieceId, input.pieceId) : undefined,
      ),
      orderBy: desc(t.thread.updatedAt),
      limit: input.limit,
    })
    return rows.map(toThread)
  },

  'threads.get': async (ctx, { id }) => {
    const thread = await ownThread(ctx, id)
    const [messages, run] = await Promise.all([
      ctx.repo.messages.many({
        where: eq(t.agentMessage.threadId, id),
        orderBy: asc(t.agentMessage.seq),
      }),
      ctx.repo.runs.first(eq(t.agentRun.threadId, id), desc(t.agentRun.startedAt)),
    ])
    return {
      thread: toThread(thread),
      messages: messages.map((m) => forStudio(toMessage(m))),
      run: run ? toRun(run) : null,
    }
  },

  'threads.delete': async (ctx, { id }) => {
    await ownThread(ctx, id)
    await ctx.repo.threads.delete(eq(t.thread.id, id))
    return { ok: true }
  },

  // Everything the message points at is checked to be the caller's before the runtime sees it.
  'threads.send': async (ctx, input) => {
    const thread = input.threadId ? await ownThread(ctx, input.threadId) : null
    if (thread && input.context.pieceId && thread.pieceId !== input.context.pieceId)
      throw badRequest('Start a new conversation for a different project')
    if (input.context.brainstorm) {
      const { pieceId, boardId } = input.context
      if (input.job || input.context.intake) throw badRequest('A brainstorm cannot start a job')
      if (thread && thread.pieceId !== (pieceId ?? null))
        throw badRequest('This brainstorm belongs to another project')
      if (boardId) {
        const board = await getBoard(ctx, boardId)
        if (!pieceId || board.pieceId !== pieceId || board.pinsFor)
          throw badRequest('Choose this project’s Design board')
      }
    }
    if (input.context.intake) {
      const { pieceId, boardId } = input.context
      if (!pieceId || !boardId || input.job)
        throw badRequest('A Home commission needs a project Design board')
      const board = await getBoard(ctx, boardId)
      if (board.pieceId !== pieceId || board.pinsFor || (thread && thread.pieceId !== pieceId))
        throw badRequest('This conversation and Design board must belong to the commission')
      input.context.stage = 'design'
    }
    await ensure(getPiece, ctx, input.context.pieceId)
    await ensure(getBoard, ctx, input.context.boardId)
    if (input.context.sceneId) {
      const shot = await getScene(ctx, input.context.sceneId)
      if (shot.pieceId !== (input.context.pieceId ?? thread?.pieceId ?? null))
        throw badRequest('Choose a shot from this project')
    }
    await ensureAll(
      input.attachments,
      (ids) => ctx.repo.assets.many({ where: inArray(t.asset.id, ids) }),
      'Asset',
    )
    await ensureAll(
      input.referenceIds,
      (ids) => ctx.repo.references.many({ where: inArray(t.reference.id, ids) }),
      'Reference',
    )
    return ctx.services.require('assistant').send(input, serviceContext(ctx))
  },

  'runs.decide': async (ctx, input) => {
    if (ctx.actor.type !== 'user')
      throw forbidden('Only a person can approve an assistant’s action')
    await ownRun(ctx, input.runId)
    return ctx.services.require('assistant').decide(input, serviceContext(ctx))
  },

  'runs.cancel': async (ctx, { runId }) => {
    await ownRun(ctx, runId)
    return ctx.services.require('assistant').cancel(runId, serviceContext(ctx))
  },

  'runs.pause': async (ctx, { runId, takeover }) => {
    await ownRun(ctx, runId)
    return ctx.services
      .require('assistant')
      .pause(runId, takeover ? 'takeover' : 'pause', serviceContext(ctx))
  },

  'runs.resume': async (ctx, input) => {
    if (ctx.actor.type !== 'user') throw forbidden('Only a person can resume an AI job')
    await ownRun(ctx, input.runId)
    return ctx.services.require('assistant').resumeJob(input, serviceContext(ctx))
  },

  'runs.accept': async (ctx, { runId }) => {
    if (ctx.actor.type !== 'user') throw forbidden('Only a person can accept an AI job’s work')
    await ownRun(ctx, runId)
    return ctx.services.require('assistant').accept(runId, serviceContext(ctx))
  },

  'client.respond': async (ctx, input) => {
    await ctx.services.require('assistant').respond(input, serviceContext(ctx))
    return { ok: true }
  },

  'traces.runs': async (ctx, input) => {
    const rows = await ctx.repo.runs.many({
      where: and(
        input.pieceId ? eq(t.agentRun.pieceId, input.pieceId) : undefined,
        seesAllRuns(ctx) ? undefined : eq(t.agentRun.userId, ctx.user.id),
      ),
      orderBy: desc(t.agentRun.startedAt),
      limit: input.limit,
    })
    return rows.map(toRun)
  },

  'traces.run': async (ctx, { id }) => {
    const run = await readableRun(ctx, id)
    const [steps, feedback] = await Promise.all([
      ctx.repo.steps.many({ where: eq(t.agentStep.runId, id), orderBy: asc(t.agentStep.idx) }),
      ctx.repo.feedback.many({
        where: eq(t.runFeedback.runId, id),
        orderBy: asc(t.runFeedback.createdAt),
      }),
    ])
    return { run: toRun(run), steps: steps.map(toStep), feedback: feedback.map(toFeedback) }
  },

  'traces.feedback': async (ctx, input) => {
    await readableRun(ctx, input.runId)
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
      source: 'explicit',
      kind: input.rating,
      rating: input.rating,
      note: input.note ?? null,
      userId: ctx.user.id,
    })
    return { ok: true }
  },
}
