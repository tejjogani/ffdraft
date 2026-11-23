import type { MeshJob } from '@pave/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { badRequest, conflict, notFound } from '../errors'
import { createId } from '../ids'
import { getMeshJob, getPiece } from '../lookups'
import { isTerminal, jobHandle, LIVE_STATUSES, publishJob, serviceContext } from '../service-context'
import type { MeshJobPatch } from '../services'
import { assertBudget, fromMicros, toMicros } from '../usage'
import { assertAttested } from './pieces'
import type { HandlerGroup } from './types'

type MeshRow = typeof t.meshJob.$inferSelect

const toMeshJob = (r: MeshRow): MeshJob => ({
  id: r.id,
  pieceId: r.pieceId,
  status: r.status,
  progress: r.progress,
  provider: r.provider,
  model: r.model,
  quality: r.quality,
  inputAssetIds: r.inputAssetIds,
  meshAssetId: r.meshAssetId,
  costUsd: r.costMicros === null ? null : fromMicros(r.costMicros),
  error: r.error,
  actor: r.actor,
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
})

/** Writes a job update unless the job has already settled; terminal states are sticky. */
async function updateMeshJob(ctx: Ctx, id: string, { costUsd, ...patch }: MeshJobPatch) {
  const [row] = await ctx.repo.meshJobs.update(
    and(eq(t.meshJob.id, id), inArray(t.meshJob.status, LIVE_STATUSES))!,
    {
      ...patch,
      ...(costUsd === undefined ? {} : { costMicros: costUsd === null ? null : toMicros(costUsd) }),
      ...(isTerminal(patch.status) ? { finishedAt: new Date() } : {}),
    },
  )
  return row
}

const announce = (ctx: Ctx, row: MeshRow) =>
  publishJob(ctx, { kind: 'mesh3d', id: row.id, pieceId: row.pieceId }, row)

/** The input photos, which must be images of the caller's org. */
async function photos(ctx: Ctx, ids: readonly string[]) {
  const rows = await ctx.repo.assets.many({ where: inArray(t.asset.id, [...ids]) })
  for (const id of ids) {
    const row = rows.find((r) => r.id === id)
    if (!row) throw notFound('Asset', id)
    if (row.kind !== 'image') throw badRequest(`“${row.name}” is not a picture`)
  }
}

export const mesh3d: HandlerGroup<'mesh3d'> = {
  'mesh3d.estimate': async (ctx, input) => {
    const service = ctx.services.require('mesh3d')
    await photos(ctx, input.imageAssetIds)
    return service.estimate(input, serviceContext(ctx))
  },

  'mesh3d.create': async (ctx, { pieceId, ...request }) => {
    const service = ctx.services.require('mesh3d')
    const piece = await getPiece(ctx, pieceId)
    assertAttested(piece)
    await photos(ctx, request.imageAssetIds)
    const sctx = serviceContext(ctx)
    const estimate = await service.estimate(request, sctx)
    await assertBudget(ctx, estimate.usd)
    const row = await ctx.repo.meshJobs.insert({
      id: createId('m3d'),
      pieceId,
      status: 'queued',
      provider: estimate.provider,
      model: estimate.model,
      quality: request.quality,
      inputAssetIds: request.imageAssetIds,
      actor: ctx.actor,
      createdBy: ctx.user.id,
    })
    const job = toMeshJob(row)
    announce(ctx, row)
    const handle = jobHandle<MeshJobPatch>(
      ctx,
      { kind: 'mesh3d', id: job.id, pieceId },
      async (patch) => updateMeshJob(ctx, job.id, patch),
    )
    const images = await Promise.all(request.imageAssetIds.map((id) => sctx.readAsset(id)))
    await service.submit(job, images, handle, sctx)
    return job
  },

  'mesh3d.list': async (ctx, { pieceId }) => {
    await getPiece(ctx, pieceId)
    const rows = await ctx.repo.meshJobs.many({
      where: eq(t.meshJob.pieceId, pieceId),
      orderBy: desc(t.meshJob.createdAt),
    })
    return rows.map(toMeshJob)
  },

  'mesh3d.get': async (ctx, { id }) => toMeshJob(await getMeshJob(ctx, id)),

  'mesh3d.cancel': async (ctx, { id }) => {
    const current = await getMeshJob(ctx, id)
    if (isTerminal(current.status)) throw conflict(`This job is already ${current.status}`)
    if (ctx.services.isConfigured('mesh3d'))
      await ctx.services.get('mesh3d').cancel(id, serviceContext(ctx))
    const row = await updateMeshJob(ctx, id, { status: 'canceled' })
    if (!row) throw conflict('This job finished before it could be canceled')
    announce(ctx, row)
    return toMeshJob(row)
  },
}
