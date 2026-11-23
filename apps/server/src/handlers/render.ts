import { mergePatch, type RenderJob, RenderSceneSchema, type SavedScene } from '@pave/schema'
import { and, asc, desc, eq, inArray, isNull, lt, max, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { type Ctx, publish } from '../context'
import * as t from '../db/schema'
import { badRequest, conflict, forbidden } from '../errors'
import { createId } from '../ids'
import { ensure, ensureAll, getPiece, getRender, getScene } from '../lookups'
import {
  isTerminal,
  jobHandle,
  LIVE_STATUSES,
  publishJob,
  serviceContext,
} from '../service-context'
import type { RenderJobPatch } from '../services'
import { toPiece } from './pieces'
import type { HandlerGroup } from './types'

type RenderRow = typeof t.renderJob.$inferSelect
type SceneRow = typeof t.renderScene.$inferSelect

const toRenderJob = (r: RenderRow, pieceVersion: number): RenderJob => ({
  id: r.id,
  pieceId: r.pieceId,
  title: r.title,
  scene: r.scene,
  requestedScene: r.requestedScene ?? r.scene,
  sceneId: r.sceneId,
  groupId: r.groupId,
  variantLabel: r.variantLabel,
  purpose: r.purpose,
  engine: r.engine,
  autoTune: r.autoTune,
  status: r.status,
  progress: r.progress,
  sourceVersion: r.sourceVersion,
  stale: r.sourceVersion < pieceVersion,
  assetIds: r.assetIds,
  critique: r.critique ?? null,
  retryOf: r.retryOf,
  note: r.note,
  starred: r.starred,
  seconds: r.seconds,
  device: r.device,
  error: r.error,
  actor: r.actor,
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
})

/** Render jobs with `stale` computed against their pieces' current versions. */
export async function toRenderJobs(ctx: Ctx, rows: RenderRow[]): Promise<RenderJob[]> {
  if (rows.length === 0) return []
  const versions = new Map(
    (
      await ctx.repo.pieces
        .select({ id: t.piece.id, version: t.piece.version }, inArray(t.piece.id, [...new Set(rows.map((r) => r.pieceId))]))
    ).map((p) => [p.id, p.version]),
  )
  return rows.map((r) => toRenderJob(r, versions.get(r.pieceId) ?? r.sourceVersion))
}

const one = async (ctx: Ctx, row: RenderRow) => (await toRenderJobs(ctx, [row]))[0]!

const toSavedScene = (r: SceneRow): SavedScene => ({
  id: r.id,
  pieceId: r.pieceId,
  title: r.title,
  scene: r.scene,
  position: r.position,
  updatedAt: r.updatedAt.toISOString(),
})

/** Writes a job update unless the job has already settled; terminal states are sticky. */
async function updateRender(ctx: Ctx, id: string, patch: RenderJobPatch & { finishedAt?: Date }) {
  const [row] = await ctx.repo.renders.update(
    and(eq(t.renderJob.id, id), inArray(t.renderJob.status, LIVE_STATUSES))!,
    { ...patch, ...(isTerminal(patch.status) ? { finishedAt: new Date() } : {}) },
  )
  return row
}

const announce = (ctx: Ctx, row: RenderRow) =>
  publishJob(ctx, { kind: 'render', id: row.id, pieceId: row.pieceId }, row)

const sceneScope = (pieceId: string | null): SQL =>
  pieceId === null ? isNull(t.renderScene.pieceId) : eq(t.renderScene.pieceId, pieceId)

const announceScene = (ctx: Ctx, row: SceneRow) =>
  publish(ctx, { type: 'scene.updated', sceneId: row.id, pieceId: row.pieceId })

export const render: HandlerGroup<'renders' | 'scenes'> = {
  'scenes.list': async (ctx, { pieceId }) => {
    await ensure(getPiece, ctx, pieceId)
    const rows = await ctx.repo.scenes.many({
      where: sceneScope(pieceId),
      orderBy: [asc(t.renderScene.position), asc(t.renderScene.createdAt)],
    })
    return rows.map(toSavedScene)
  },

  'scenes.create': async (ctx, input) => {
    await ensure(getPiece, ctx, input.pieceId)
    const [last] = await ctx.repo.scenes.select(
      { position: max(t.renderScene.position) },
      sceneScope(input.pieceId),
    )
    const row = await ctx.repo.scenes.insert({
      id: createId('scn'),
      pieceId: input.pieceId,
      title: input.title,
      scene: input.scene,
      position: input.position ?? (last?.position ?? 0) + 1,
      createdBy: ctx.user.id,
    })
    announceScene(ctx, row)
    return toSavedScene(row)
  },

  'scenes.update': async (ctx, { id, patch, ...rest }) => {
    const current = await getScene(ctx, id)
    let scene = current.scene
    if (patch) {
      const parsed = RenderSceneSchema.safeParse(mergePatch(current.scene, patch))
      if (!parsed.success) throw badRequest(z.prettifyError(parsed.error), parsed.error.issues)
      scene = parsed.data
    }
    const [row] = await ctx.repo.scenes.update(eq(t.renderScene.id, id), {
      ...rest,
      scene,
      updatedAt: new Date(),
    })
    announceScene(ctx, row!)
    return toSavedScene(row!)
  },

  'scenes.delete': async (ctx, { id }) => {
    const row = await getScene(ctx, id)
    await ctx.repo.scenes.delete(eq(t.renderScene.id, id))
    announceScene(ctx, row)
    return { ok: true }
  },

  'renders.list': async (ctx, input) => {
    const before = input.before === undefined ? undefined : new Date(input.before)
    if (before && Number.isNaN(before.getTime())) throw badRequest('`before` must be a date')
    const rows = await ctx.repo.renders.many({
      where: and(
        eq(t.renderJob.purpose, input.purpose),
        input.pieceId ? eq(t.renderJob.pieceId, input.pieceId) : undefined,
        before ? lt(t.renderJob.createdAt, before) : undefined,
      ),
      orderBy: desc(t.renderJob.createdAt),
      limit: input.limit,
    })
    return toRenderJobs(ctx, rows)
  },

  'renders.get': async (ctx, { id }) => one(ctx, await getRender(ctx, id)),

  // Blender jobs go to the render queue; browser jobs wait for the user's studio to render them
  // and deliver the result with renders.complete.
  'renders.create': async (ctx, input) => {
    const piece = await getPiece(ctx, input.pieceId)
    const saved = input.sceneId ? await getScene(ctx, input.sceneId) : null
    if (saved && saved.pieceId !== null && saved.pieceId !== piece.id)
      throw badRequest('That shot belongs to another piece')
    await ensure(getRender, ctx, input.retryOf)
    const engine =
      input.engine === 'blender'
        ? (ctx.services.require('renderQueue'), 'blender')
        : input.engine === 'auto' &&
            ctx.services.isConfigured('renderQueue') &&
            ctx.services.capabilities().blender
          ? 'blender'
          : 'browser'
    const scene = input.scene ?? saved!.scene
    const row = await ctx.repo.renders.insert({
      id: createId('rnd'),
      pieceId: piece.id,
      title: input.title ?? saved?.title ?? piece.title,
      scene,
      requestedScene: scene,
      sceneId: saved?.id ?? null,
      groupId: input.groupId ?? null,
      variantLabel: input.variantLabel ?? null,
      purpose: input.purpose,
      engine,
      autoTune: input.autoTune,
      status: 'queued',
      sourceVersion: piece.version,
      retryOf: input.retryOf ?? null,
      note: input.note ?? null,
      actor: ctx.actor,
      createdBy: ctx.user.id,
    })
    const job = await one(ctx, row)
    announce(ctx, row)
    if (engine === 'blender') {
      const handle = jobHandle<RenderJobPatch>(
        ctx,
        { kind: 'render', id: job.id, pieceId: job.pieceId },
        async (patch) => updateRender(ctx, job.id, patch),
      )
      await ctx.services
        .get('renderQueue')
        .submit(job, await toPiece(ctx, piece), handle, serviceContext(ctx))
    }
    return job
  },

  'renders.complete': async (ctx, { id, assetIds, error, seconds, device }) => {
    const job = await getRender(ctx, id)
    if (job.engine !== 'browser') throw conflict('Only browser renders are completed this way')
    if (job.createdBy !== ctx.user.id)
      throw forbidden('Only the person who queued this render can deliver it')
    await ensureAll(
      ctx,
      assetIds,
      (ids) => ctx.repo.assets.many({ where: inArray(t.asset.id, ids) }),
      'Asset',
    )
    const row = await updateRender(ctx, id, {
      status: error === undefined ? 'done' : 'failed',
      progress: error === undefined ? 1 : job.progress,
      assetIds,
      error: error ?? null,
      seconds: seconds ?? null,
      device: device ?? null,
    })
    // First write wins: a second delivery, or one after a cancel, is refused.
    if (!row) throw conflict(`This render is already ${job.status}`)
    announce(ctx, row)
    return one(ctx, row)
  },

  'renders.update': async (ctx, { id, ...patch }) => {
    await getRender(ctx, id)
    const [row] = await ctx.repo.renders.update(eq(t.renderJob.id, id), patch)
    announce(ctx, row!)
    return one(ctx, row!)
  },

  'renders.cancel': async (ctx, { id }) => {
    const current = await getRender(ctx, id)
    if (isTerminal(current.status)) throw conflict(`This render is already ${current.status}`)
    if (current.engine === 'blender' && ctx.services.isConfigured('renderQueue'))
      await ctx.services.get('renderQueue').cancel(id, serviceContext(ctx))
    const row = await updateRender(ctx, id, { status: 'canceled' })
    if (!row) throw conflict('This render finished before it could be canceled')
    announce(ctx, row)
    return one(ctx, row)
  },

  'renders.delete': async (ctx, { id }) => {
    const job = await getRender(ctx, id)
    if (!isTerminal(job.status)) throw conflict('Cancel this render before deleting it')
    await ctx.repo.renders.delete(eq(t.renderJob.id, id))
    return { ok: true }
  },

  // Answered even without an engine service: "not available" is the status, not an error.
  'renders.engine': async (ctx) => {
    const engine = ctx.services.optional('renderEngine')
    if (engine) return engine.status(serviceContext(ctx))
    return {
      available: ctx.services.capabilities().blender,
      version: null,
      device: null,
      path: null,
      reason: ctx.services.capabilities().blender
        ? null
        : 'This server has no Blender set up; renders use the browser (preview quality).',
    }
  },

  'renders.configureEngine': async (ctx, { blenderPath }) => {
    if (ctx.authMode !== 'local')
      throw forbidden('The render engine can only be configured on a local install')
    return ctx.services.require('renderEngine').configure(blenderPath, serviceContext(ctx))
  },
}
