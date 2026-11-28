import type { BrandModel, ModelShot } from '@pave/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getAssetRow, putAsset, toAsset } from '../assets/assets'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { AppError, conflict, forbidden } from '../errors'
import { createId } from '../ids'
import { engineError, shotHandle, stopJob, updateShot } from '../jobs'
import { getModel, getPiece, getShot } from '../lookups'
import { isTerminal, publishJob, serviceContext, stepProgress } from '../service-context'
import { assertBudget } from '../usage'
import { toPiece } from './pieces'
import type { HandlerGroup } from './types'

type ModelRow = typeof t.brandModel.$inferSelect
type ShotRow = typeof t.modelShot.$inferSelect

export const toBrandModel = (r: ModelRow): BrandModel => ({
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
export async function toShots(ctx: Ctx, rows: ShotRow[]): Promise<ModelShot[]> {
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
    toShot(r, {
      piece: pv.get(r.pieceId) ?? r.sourceVersion,
      model: mv.get(r.modelId) ?? r.modelVersion,
    }),
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

  'models.estimatePortraits': async (ctx, { id, views }) => {
    const model = toBrandModel(await getModel(ctx, id))
    return ctx.services.get('onModel').estimatePortraits(model, views, serviceContext(ctx))
  },

  'models.generatePortraits': async (ctx, { id, views }) => {
    const original = await getModel(ctx, id)
    const model = toBrandModel(original)
    if (model.status === 'approved')
      throw conflict(
        'Approved models keep their portraits; set the model back to draft to regenerate',
      )
    const onModel = ctx.services.get('onModel')
    const sctx = serviceContext(ctx)
    // The figure the person confirmed is the one checked against the budget.
    await assertBudget(ctx, (await onModel.estimatePortraits(model, views, sctx)).usd)
    const generated = await onModel.portraits(model, views, sctx)
    const fresh: BrandModel['portraits'] = []
    for (const { view, file } of generated.portraits)
      fresh.push({ view, assetId: (await putAsset(ctx, { ...file, kind: 'image' })).id })
    // A new headshot defines a fresh identity. Other views must be conditioned on that headshot.
    const kept = fresh.some((p) => p.view === 'face')
      ? []
      : model.portraits.filter((p) => !fresh.some((f) => f.view === p.view))
    const [row] = await ctx.repo.models.update(
      and(
        eq(t.brandModel.id, id),
        eq(t.brandModel.status, 'draft'),
        eq(t.brandModel.version, original.version),
        eq(t.brandModel.card, original.card),
        eq(t.brandModel.portraits, original.portraits),
      )!,
      { portraits: [...kept, ...fresh], recipe: generated.recipe, updatedAt: new Date() },
    )
    if (!row)
      throw conflict(
        'This model changed while the portraits were being made. Review its card and try again.',
      )
    return toBrandModel(row)
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
    const [model, piece] = await Promise.all([
      getModel(ctx, input.modelId),
      getPiece(ctx, input.pieceId),
    ])
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
    const subject = { model: toBrandModel(model), piece: await toPiece(ctx, piece) }
    await assertBudget(ctx, (await onModel.estimate(input, subject, serviceContext(ctx))).usd)
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
        createdBy: ctx.user.id,
      })),
    )
    const shots = await toShots(ctx, rows)
    for (const row of rows) announce(ctx, row)
    for (const [i, shot] of shots.entries()) {
      try {
        await onModel.submitShot(shot, subject, shotHandle(ctx, shot), serviceContext(ctx))
      } catch (err) {
        // This shot and the ones not yet handed over will never run: fail them, not leave them queued.
        if (!(err instanceof AppError)) console.error(`Submitting shot ${shot.id} failed:`, err)
        for (const rest of shots.slice(i))
          await shotHandle(ctx, rest).update({ status: 'failed', error: engineError(err) })
        throw err
      }
    }
    return shots
  },

  'shots.cancel': async (ctx, { id }) => {
    const shot = await getShot(ctx, id)
    if (isTerminal(shot.status)) throw conflict(`This image is already ${shot.status}`)
    if (ctx.services.isConfigured('onModel'))
      await stopJob(id, () => ctx.services.get('onModel').cancelShot(id, serviceContext(ctx)))
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
