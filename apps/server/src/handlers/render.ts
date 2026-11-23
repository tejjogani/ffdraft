import type { RenderJob } from '@pave/schema'
import { desc, eq } from 'drizzle-orm'
import { type Ctx, publish } from '../context'
import * as t from '../db/schema'
import { conflict } from '../errors'
import { createId } from '../ids'
import { getPiece, getRender } from '../lookups'
import { isTerminal, jobHandle, serviceContext } from '../service-context'
import type { RenderJobPatch } from '../services'
import { toPiece } from './pieces'
import type { HandlerGroup } from './types'

export const toRenderJob = (r: typeof t.renderJob.$inferSelect): RenderJob => ({
  id: r.id,
  pieceId: r.pieceId,
  title: r.title,
  scene: r.scene,
  engine: r.engine,
  status: r.status,
  progress: r.progress,
  sourceVersion: r.sourceVersion,
  assetIds: r.assetIds,
  error: r.error,
  actor: r.actor,
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
})

const updateRender = async (ctx: Ctx, id: string, patch: RenderJobPatch) => {
  const [row] = await ctx.repo.renders.update(eq(t.renderJob.id, id), {
    ...patch,
    ...(isTerminal(patch.status) ? { finishedAt: new Date() } : {}),
  })
  return row!
}

export const render: HandlerGroup<'renders'> = {
  'renders.list': async (ctx, input) => {
    const rows = await ctx.repo.renders.many({
      where: input.pieceId ? eq(t.renderJob.pieceId, input.pieceId) : undefined,
      orderBy: desc(t.renderJob.createdAt),
      limit: input.limit,
    })
    return rows.map(toRenderJob)
  },

  'renders.get': async (ctx, { id }) => toRenderJob(await getRender(ctx, id)),

  // The job is persisted as queued; a registered render queue picks it up, otherwise it waits.
  'renders.create': async (ctx, input) => {
    const piece = await getPiece(ctx, input.pieceId)
    const row = await ctx.repo.renders.insert({
      id: createId('rnd'),
      pieceId: piece.id,
      title: input.title ?? piece.title,
      scene: input.scene,
      engine: 'blender',
      status: 'queued',
      sourceVersion: piece.version,
      actor: ctx.actor,
    })
    const job = toRenderJob(row)
    publish(ctx, { type: 'job.updated', kind: 'render', id: job.id, pieceId: job.pieceId })
    if (ctx.services.isConfigured('renderQueue')) {
      const handle = jobHandle<RenderJobPatch>(
        ctx,
        { kind: 'render', id: job.id, pieceId: job.pieceId },
        (patch) => updateRender(ctx, job.id, patch),
      )
      await ctx.services
        .get('renderQueue')
        .submit(job, await toPiece(ctx, piece), handle, serviceContext(ctx))
    }
    return job
  },

  'renders.cancel': async (ctx, { id }) => {
    const current = await getRender(ctx, id)
    if (isTerminal(current.status)) throw conflict(`This render is already ${current.status}`)
    if (ctx.services.isConfigured('renderQueue'))
      await ctx.services.get('renderQueue').cancel(id, serviceContext(ctx))
    const row = await updateRender(ctx, id, { status: 'canceled' })
    publish(ctx, { type: 'job.updated', kind: 'render', id, pieceId: row.pieceId })
    return toRenderJob(row)
  },
}
