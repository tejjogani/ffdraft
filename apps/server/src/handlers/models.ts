import type { BrandModel, ModelShot } from '@pave/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getAssetRow, putAsset, toAsset } from '../assets/assets'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { conflict, forbidden } from '../errors'
import { createId } from '../ids'
import { getModel, getPiece, getShot } from '../lookups'
import {
  isTerminal,
  jobHandle,
  LIVE_STATUSES,
  publishJob,
  serviceContext,
  stepProgress,
} from '../service-context'
import type { ModelShotPatch } from '../services'
import { assertBudget } from '../usage'
import { toPiece } from './pieces'
import type { HandlerGroup } from './types'

type ModelRow = typeof t.brandModel.$inferSelect
type ShotRow = typeof t.modelShot.$inferSelect

const toBrandModel = (r: ModelRow): BrandModel => ({
  id: r.id,
  name: r.name,
  // Cards written before these fields existed lack them.
  card: {
    ...r.card,
    monkTone: r.card.monkTone ?? null,
    undertone: r.card.undertone ?? null,
    eyes: r.card.eyes ?? '',
    marks: r.card.marks ?? '',
    handLengthMm: r.card.handLengthMm ?? null,
  },
  portraits: r.portraits,
  recipe: r.recipe ?? null,
  attestedSynthetic: r.attestedSynthetic,
  status: r.status,
  version: r.version,
  approvedBy: r.approvedBy,
  approvedAt: r.approvedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
})

const toShot = (r: ShotRow, current: { piece: number; model: number }): ModelShot => ({
  id: r.id,
  modelId: r.modelId,
  pieceId: r.pieceId,
  assetId: r.assetId,
  placement: r.placement,
  direction: r.direction,
  aspect: r.aspect,
  fidelity: r.fidelity,
  status: r.status,
  stage: r.stage,
  attempts: r.attempts,
  error: r.error,
  sourceVersion: r.sourceVersion,
  modelVersion: r.modelVersion,
  stale: r.sourceVersion < current.piece || r.modelVersion < current.model,
  check: r.check ? { ...r.check, findings: r.check.findings ?? [] } : null,
  provenance: r.provenance ?? null,
  actor: r.actor ?? { type: 'system' },
  createdAt: r.createdAt.toISOString(),
})

/** Shots with `stale` computed against the current piece and model versions. */
async function toShots(ctx: Ctx, rows: ShotRow[]): Promise<ModelShot[]> {
  if (rows.length === 0) return []
  const [pieces, models] = await Promise.all([
    ctx.repo.pieces.select(
      { id: t.piece.id, version: t.piece.version },
      inArray(t.piece.id, [...new Set(rows.map((r) => r.pieceId))]),
    ),
    ctx.repo.models.select(
      { id: t.brandModel.id, version: t.brandModel.version },
      inArray(t.brandModel.id, [...new Set(rows.map((r) => r.modelId))]),
    ),
  ])
  const pv = new Map(pieces.map((p) => [p.id, p.version]))
  const mv = new Map(models.map((m) => [m.id, m.version]))
  return rows.map((r) =>
    toShot(r, { piece: pv.get(r.pieceId) ?? r.sourceVersion, model: mv.get(r.modelId) ?? r.modelVersion }),
  )
}

const oneShot = async (ctx: Ctx, row: ShotRow) => (await toShots(ctx, [row]))[0]!

async function updateModel(ctx: Ctx, id: string, patch: Partial<typeof t.brandModel.$inferInsert>) {
  const [row] = await ctx.repo.models.update(eq(t.brandModel.id, id), {
    ...patch,
    updatedAt: new Date(),
  })
  return toBrandModel(row!)
}

/** Writes a shot update unless the shot has already settled; terminal states are sticky. */
async function updateShot(ctx: Ctx, id: string, patch: ModelShotPatch) {
  const [row] = await ctx.repo.shots.update(
    and(eq(t.modelShot.id, id), inArray(t.modelShot.status, LIVE_STATUSES))!,
    patch,
  )
  return row
}

const announce = (ctx: Ctx, row: ShotRow) =>
  publishJob(
    ctx,
    { kind: 'shot', id: row.id, pieceId: row.pieceId },
    { status: row.status, progress: stepProgress(row.status) },
  )

const requirePerson = (ctx: Ctx, what: string) => {
  if (ctx.actor.type !== 'user') throw forbidden(`Only a person can ${what}`)
}

export const models: HandlerGroup<'models' | 'shots'> = {
  'models.list': async (ctx) => {
    const rows = await ctx.repo.models.many({ orderBy: desc(t.brandModel.createdAt) })
    return rows.map(toBrandModel)
  },

  'models.create': async (ctx, input) => {
    requirePerson(ctx, 'attest that a brand model is synthetic')
    const row = await ctx.repo.models.insert({
      id: createId('mdl'),
      name: input.name,
      card: input.card,
      attestedSynthetic: input.attestedSynthetic,
      status: 'draft',
    })
    return toBrandModel(row)
  },

  // Approval freezes the card and portraits, records the approver and bumps the version.
  'models.update': async (ctx, { id, card, status, ...patch }) => {
    const current = await getModel(ctx, id)
    const changing = status !== undefined && status !== current.status
    if (changing) requirePerson(ctx, 'approve or reopen a brand model')
    if (card && current.status === 'approved' && status !== 'draft')
      throw conflict('This model is approved; set it back to draft to change its card')
    return updateModel(ctx, id, {
      ...patch,
      ...(card ? { card: { ...toBrandModel(current).card, ...card } } : {}),
      ...(changing && status === 'approved'
        ? { status, approvedBy: ctx.user.id, approvedAt: new Date(), version: current.version + 1 }
        : {}),
      ...(changing && status === 'draft' ? { status, approvedBy: null, approvedAt: null } : {}),
    })
  },

  'models.generatePortraits': async (ctx, { id, views }) => {
    const model = toBrandModel(await getModel(ctx, id))
    if (model.status === 'approved')
      throw conflict(
        'Approved models keep their portraits; set the model back to draft to regenerate',
      )
    await assertBudget(ctx)
    const sctx = serviceContext(ctx)
    const generated = await ctx.services.get('onModel').portraits(model, views, sctx)
    const fresh: BrandModel['portraits'] = []
    for (const { view, file } of generated.portraits)
      fresh.push({ view, assetId: (await putAsset(ctx, { ...file, kind: 'image' })).id })
    const kept = model.portraits.filter((p) => !fresh.some((f) => f.view === p.view))
    return updateModel(ctx, id, { portraits: [...kept, ...fresh], recipe: generated.recipe })
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
    return toShots(ctx, rows)
  },

  'shots.get': async (ctx, { id }) => oneShot(ctx, await getShot(ctx, id)),

  'shots.estimate': async (ctx, input) => {
    const onModel = ctx.services.require('onModel')
    const [model, piece] = await Promise.all([getModel(ctx, input.modelId), getPiece(ctx, input.pieceId)])
    return onModel.estimate(
      input,
      { model: toBrandModel(model), piece: await toPiece(ctx, piece) },
      serviceContext(ctx),
    )
  },

  'shots.create': async (ctx, input) => {
    const onModel = ctx.services.require('onModel')
    const [model, piece] = await Promise.all([
      getModel(ctx, input.modelId),
      getPiece(ctx, input.pieceId),
    ])
    if (model.status !== 'approved')
      throw conflict('Approve this brand model before making on-model images with it')
    await assertBudget(ctx)
    const rows = await ctx.repo.shots.insertMany(
      Array.from({ length: input.count }, () => ({
        id: createId('sht'),
        modelId: model.id,
        pieceId: piece.id,
        placement: input.placement,
        direction: input.direction,
        aspect: input.aspect,
        fidelity: 'concept' as const,
        status: 'queued' as const,
        sourceVersion: piece.version,
        modelVersion: model.version,
        actor: ctx.actor,
      })),
    )
    const shots = await toShots(ctx, rows)
    const subject = { model: toBrandModel(model), piece: await toPiece(ctx, piece) }
    for (const [i, shot] of shots.entries()) {
      announce(ctx, rows[i]!)
      const handle = jobHandle<ModelShotPatch>(
        ctx,
        { kind: 'shot', id: shot.id, pieceId: shot.pieceId },
        async (patch) => {
          const row = await updateShot(ctx, shot.id, patch)
          return row && { status: row.status, progress: stepProgress(row.status) }
        },
      )
      await onModel.submitShot(shot, subject, handle, serviceContext(ctx))
    }
    return shots
  },

  'shots.cancel': async (ctx, { id }) => {
    const shot = await getShot(ctx, id)
    if (isTerminal(shot.status)) throw conflict(`This image is already ${shot.status}`)
    if (ctx.services.isConfigured('onModel'))
      await ctx.services.get('onModel').cancelShot(id, serviceContext(ctx))
    const row = await updateShot(ctx, id, { status: 'canceled' })
    if (!row) throw conflict('This image finished before it could be canceled')
    announce(ctx, row)
    return oneShot(ctx, row)
  },

  'shots.delete': async (ctx, { id }) => {
    const shot = await getShot(ctx, id)
    if (!isTerminal(shot.status)) throw conflict('Cancel this image before deleting it')
    await ctx.repo.shots.delete(eq(t.modelShot.id, id))
    return { ok: true }
  },

  // Fail closed: only a shot that passed its check against the CAD leaves the studio.
  'shots.export': async (ctx, { id, label }) => {
    const row = await getShot(ctx, id)
    if (!row.check?.passed || !row.assetId)
      throw conflict('This image did not match the design, so it cannot be exported')
    if (!label) return toAsset(await getAssetRow(ctx, row.assetId))
    const file = await ctx.services
      .require('onModel')
      .exportShot(await oneShot(ctx, row), serviceContext(ctx))
    return putAsset(ctx, { ...file, kind: 'image' })
  },
}
