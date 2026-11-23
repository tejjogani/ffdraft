import type { BrandModel, ModelShot } from '@pave/schema'
import { and, desc, eq } from 'drizzle-orm'
import { putAsset } from '../assets/assets'
import { type Ctx, publish } from '../context'
import * as t from '../db/schema'
import { conflict } from '../errors'
import { createId } from '../ids'
import { getModel, getPiece } from '../lookups'
import { jobHandle, serviceContext } from '../service-context'
import type { ModelShotPatch } from '../services'
import { toPiece } from './pieces'
import type { HandlerGroup } from './types'

const toBrandModel = (r: typeof t.brandModel.$inferSelect): BrandModel => ({
  id: r.id,
  name: r.name,
  card: r.card,
  portraits: r.portraits,
  attestedSynthetic: r.attestedSynthetic,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
})

const toShot = (r: typeof t.modelShot.$inferSelect): ModelShot => ({
  id: r.id,
  modelId: r.modelId,
  pieceId: r.pieceId,
  assetId: r.assetId,
  placement: r.placement,
  direction: r.direction,
  fidelity: r.fidelity,
  status: r.status,
  check: r.check ?? null,
  createdAt: r.createdAt.toISOString(),
})

const updateModel = async (
  ctx: Ctx,
  id: string,
  patch: Partial<typeof t.brandModel.$inferInsert>,
) => {
  const [row] = await ctx.repo.models.update(eq(t.brandModel.id, id), {
    ...patch,
    updatedAt: new Date(),
  })
  return toBrandModel(row!)
}

export const models: HandlerGroup<'models' | 'shots'> = {
  'models.list': async (ctx) => {
    const rows = await ctx.repo.models.many({ orderBy: desc(t.brandModel.createdAt) })
    return rows.map(toBrandModel)
  },

  'models.create': async (ctx, input) => {
    const row = await ctx.repo.models.insert({
      id: createId('mdl'),
      name: input.name,
      card: input.card,
      attestedSynthetic: input.attestedSynthetic,
      status: 'draft',
    })
    return toBrandModel(row)
  },

  'models.update': async (ctx, { id, card, ...patch }) => {
    const current = await getModel(ctx, id)
    return updateModel(ctx, id, {
      ...patch,
      ...(card ? { card: { ...current.card, ...card } } : {}),
    })
  },

  'models.generatePortraits': async (ctx, { id, views }) => {
    const model = toBrandModel(await getModel(ctx, id))
    if (model.status === 'approved')
      throw conflict(
        'Approved models keep their portraits; set the model back to draft to regenerate',
      )
    const sctx = serviceContext(ctx)
    const generated = await ctx.services.get('onModel').portraits(model, views, sctx)
    const fresh: BrandModel['portraits'] = []
    for (const { view, file } of generated)
      fresh.push({ view, assetId: (await putAsset(ctx, { ...file, kind: 'image' })).id })
    const kept = model.portraits.filter((p) => !fresh.some((f) => f.view === p.view))
    return updateModel(ctx, id, { portraits: [...kept, ...fresh] })
  },

  'models.delete': async (ctx, { id }) => {
    await getModel(ctx, id)
    await ctx.repo.models.delete(eq(t.brandModel.id, id))
    return { ok: true }
  },

  'shots.list': async (ctx, input) => {
    const where = and(
      input.pieceId ? eq(t.modelShot.pieceId, input.pieceId) : undefined,
      input.modelId ? eq(t.modelShot.modelId, input.modelId) : undefined,
    )
    const rows = await ctx.repo.shots.many({ where, orderBy: desc(t.modelShot.createdAt) })
    return rows.map(toShot)
  },

  'shots.create': async (ctx, input) => {
    const onModel = ctx.services.require('onModel')
    const [model, piece] = await Promise.all([
      getModel(ctx, input.modelId),
      getPiece(ctx, input.pieceId),
    ])
    const row = await ctx.repo.shots.insert({
      id: createId('sht'),
      modelId: model.id,
      pieceId: piece.id,
      placement: input.placement,
      direction: input.direction,
      fidelity: 'concept',
      status: 'queued',
    })
    const shot = toShot(row)
    const handle = jobHandle<ModelShotPatch>(
      ctx,
      { kind: 'shot', id: shot.id, pieceId: shot.pieceId },
      (patch) => ctx.repo.shots.update(eq(t.modelShot.id, shot.id), patch),
    )
    publish(ctx, { type: 'job.updated', kind: 'shot', id: shot.id, pieceId: shot.pieceId })
    await onModel.submitShot(
      shot,
      { model: toBrandModel(model), piece: await toPiece(ctx, piece) },
      handle,
      serviceContext(ctx),
    )
    return shot
  },
}
