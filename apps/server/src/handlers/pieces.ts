import {
  buildDesign,
  type Design,
  emptyBuildReason,
  emptyDesign,
  isRhinoRoleBody,
  originNeedsAttestation,
  PAVE_MIME,
  type Piece,
  type PieceKind,
  type PieceOrigin,
  type PieceOriginInputSchema,
  type PieceSpec,
  PieceSpecSchema,
  type PieceSummary,
  STAGES,
  type Stage,
  TEMPLATES,
} from '@pave/schema'
import { and, desc, eq, ilike, inArray, isNull, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { assetBytes, getAssetRow, putAsset } from '../assets/assets'
import { type Ctx, invoke, publish } from '../context'
import * as t from '../db/schema'
import { commitChange, refreshFacts, refreshMissingFacts, replaceDesignOps } from '../design'
import { chooseDirection, proposeDirections, removeDirection, toDirection } from '../directions'
import { AppError, badRequest, conflict, forbidden } from '../errors'
import { addIntakeAssets, confirmIntake, startIntake } from '../home-intake'
import { estimateSpec, openAsCad, takeToCad } from '../ideas'
import { createId } from '../ids'
import { ensure, ensureAll, getCollection, getPiece } from '../lookups'
import { openPieceFile } from '../pavefile/open'
import { savePieceFile } from '../pavefile/save'
import { recordRenderFeedback, takeAgent } from '../render-feedback'
import { LIVE_STATUSES } from '../service-context'
import type { HandlerGroup } from './types'

type PieceRow = typeof t.piece.$inferSelect

export const toPieceSummary = (r: PieceRow): PieceSummary => ({
  id: r.id,
  title: r.title,
  kind: r.kind,
  stage: r.stage,
  collectionId: r.collectionId,
  coverAssetId: r.coverAssetId,
  coverAuto: r.coverAuto,
  facts: r.facts,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

export async function toPiece(ctx: Ctx, r: PieceRow): Promise<Piece> {
  const boards = await ctx.repo.boards.many({
    where: eq(t.board.pieceId, r.id),
    orderBy: desc(t.board.updatedAt),
  })
  return {
    ...toPieceSummary(r),
    brief: r.brief,
    spec: r.spec,
    ...(r.intake ? { intake: r.intake } : {}),
    design: r.design,
    version: r.version,
    boardIds: boards.map((b) => b.id),
    origin: r.origin ?? null,
    directions: (r.directions ?? []).map(toDirection),
    chosenDirectionId: r.chosenDirectionId ?? null,
    provenance: r.provenance ?? null,
  }
}

/**
 * Refuses (409) to send a piece made from someone's artwork to a 3D provider, an export or a
 * production package before a person has attested they may use it.
 */
export function assertAttested(piece: Pick<PieceRow, 'origin'>): void {
  if (originNeedsAttestation(piece.origin ?? null))
    throw conflict(
      'This piece is made from artwork someone must confirm they may use. Ask the designer to confirm it (pieces.attest) first.',
      { reason: 'attestation_required' },
    )
}

type OriginInput = z.output<typeof PieceOriginInputSchema>

/** Checks an origin's sources belong to the org and stores it; the attestation is kept only while the sources are unchanged. */
async function toOrigin(
  ctx: Ctx,
  input: OriginInput,
  previous: PieceOrigin | null,
): Promise<PieceOrigin> {
  await ensureAll(
    input.sourceAssetIds,
    (ids) => ctx.repo.assets.many({ where: inArray(t.asset.id, ids) }),
    'Asset',
  )
  await ensureAll(
    input.referenceIds,
    (ids) => ctx.repo.references.many({ where: inArray(t.reference.id, ids) }),
    'Reference',
  )
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((x, i) => x === b[i])
  const keep =
    previous !== null &&
    same(previous.sourceAssetIds, input.sourceAssetIds) &&
    same(previous.referenceIds, input.referenceIds)
  return { ...input, attestation: keep ? previous.attestation : null }
}

/**
 * Only a person may lift the attestation gate. Clearing an origin, or dropping its sources or
 * flags, would let export and production through as surely as attesting, so an assistant (or
 * any non-person actor) may only add to an origin; adding sources clears an attestation.
 */
function assertOnlyAdds(previous: PieceOrigin | null, next: OriginInput | null): void {
  if (previous === null) return
  const keeps = (had: readonly string[], has: readonly string[]) =>
    had.every((x) => has.includes(x))
  const ok =
    next !== null &&
    keeps(previous.sourceAssetIds, next.sourceAssetIds) &&
    keeps(previous.referenceIds, next.referenceIds) &&
    keeps(
      previous.flags.map((f) => f.code),
      next.flags.map((f) => f.code),
    )
  if (!ok)
    throw forbidden(
      'Only a person can clear a piece’s origin or remove its sources or flags; the assistant may only add to them',
    )
}

/** Moves a piece forward to `stage`, never back: stages are a status, not a gate. */
const advance = (current: Stage, to: Stage): Stage =>
  STAGES.indexOf(current) < STAGES.indexOf(to) ? to : current

function startingPoint(input: { templateId?: string; spec?: PieceSpec; kind?: PieceKind }): {
  spec: PieceSpec | null
  design: Design
  stage: Stage
} {
  if (input.templateId) {
    const template = TEMPLATES.find((x) => x.id === input.templateId)
    if (!template) throw badRequest(`Unknown template "${input.templateId}"`)
    return {
      spec: PieceSpecSchema.parse(template.spec),
      design: buildDesign(template.spec),
      stage: 'design',
    }
  }
  if (input.spec) return { spec: input.spec, design: buildDesign(input.spec), stage: 'design' }
  return { spec: null, design: emptyDesign(input.kind ?? 'ring'), stage: 'idea' }
}

async function insertPiece(
  ctx: Ctx,
  values: Omit<typeof t.piece.$inferInsert, 'orgId' | 'id' | 'createdBy'>,
) {
  const row = await ctx.repo.pieces.insert({
    id: createId('pc'),
    createdBy: ctx.user.id,
    ...values,
  })
  refreshFacts(ctx, row.id, row.version, row.design)
  publish(ctx, { type: 'piece.updated', pieceId: row.id })
  return toPiece(ctx, row)
}

/**
 * Cancels the piece's renders, image-to-3D jobs and on-model images that are still queued or
 * running, each through its own cancel command: the engine is told to stop and the job is
 * published as canceled. Deleting the piece deletes their rows, and without this Blender would
 * go on rendering, a paid provider go on working, and whoever waits on a job wait for ever.
 */
async function cancelLiveJobs(ctx: Ctx, pieceId: string): Promise<void> {
  const [renders, meshJobs, shots] = await Promise.all([
    ctx.repo.renders.many({
      where: and(eq(t.renderJob.pieceId, pieceId), inArray(t.renderJob.status, LIVE_STATUSES)),
    }),
    ctx.repo.meshJobs.many({
      where: and(eq(t.meshJob.pieceId, pieceId), inArray(t.meshJob.status, LIVE_STATUSES)),
    }),
    ctx.repo.shots.many({
      where: and(eq(t.modelShot.pieceId, pieceId), inArray(t.modelShot.status, LIVE_STATUSES)),
    }),
  ])
  // A job that settles before its turn answers 409: there is nothing left to stop.
  const settledMeanwhile = (err: unknown) => {
    if (!(err instanceof AppError && err.code === 'conflict')) throw err
  }
  for (const { id } of renders) await invoke(ctx, 'renders.cancel', { id }).catch(settledMeanwhile)
  for (const { id } of meshJobs) await invoke(ctx, 'mesh3d.cancel', { id }).catch(settledMeanwhile)
  for (const { id } of shots) await invoke(ctx, 'shots.cancel', { id }).catch(settledMeanwhile)
}

/** A person made one of the assistant's takes the piece's cover: the strongest "kept". */
async function noteCover(ctx: Ctx, pieceId: string, assetId: string): Promise<void> {
  if (ctx.actor.type !== 'user') return
  const takes = await ctx.repo.renders.many({
    where: and(eq(t.renderJob.pieceId, pieceId), eq(t.renderJob.status, 'done')),
    orderBy: desc(t.renderJob.createdAt),
    limit: 200,
  })
  const take = takes.find((r) => r.assetIds.includes(assetId))
  const agent = take && takeAgent(take)
  if (agent)
    await recordRenderFeedback(ctx, {
      agent,
      kind: 'kept',
      target: `render:${take.id}`,
      detail: `Set the take “${take.title}”, which the assistant rendered, as the piece’s cover.`,
    })
}

export const pieces: HandlerGroup<'pieces'> = {
  'pieces.list': async (ctx, input) => {
    const where: SQL[] = []
    if (input.collectionId === null) where.push(isNull(t.piece.collectionId))
    else if (input.collectionId) where.push(eq(t.piece.collectionId, input.collectionId))
    if (input.stage) where.push(eq(t.piece.stage, input.stage))
    if (input.q) where.push(ilike(t.piece.title, `%${input.q.replace(/[\\%_]/g, '\\$&')}%`))
    const rows = await ctx.repo.pieces.many({
      where: and(...where),
      orderBy: desc(t.piece.updatedAt),
      limit: input.limit,
    })
    return rows.map(toPieceSummary)
  },

  'pieces.get': async (ctx, { id }) => {
    const row = await getPiece(ctx, id)
    if (row.facts === null && Object.values(row.design.nodes).some(isRhinoRoleBody))
      refreshMissingFacts(ctx, row.id, row.version, row.design)
    return toPiece(ctx, row)
  },

  'pieces.create': async (ctx, input) => {
    await ensure(getCollection, ctx, input.collectionId)
    const start = startingPoint(input)
    return insertPiece(ctx, {
      title: input.title ?? start.spec?.title ?? 'Untitled piece',
      kind: start.design.kind,
      stage: start.stage,
      brief: input.brief ?? '',
      spec: start.spec,
      design: start.design,
      collectionId: input.collectionId ?? null,
      origin: input.origin ? await toOrigin(ctx, input.origin, null) : null,
    })
  },

  'pieces.startIntake': startIntake,

  'pieces.addIntakeAssets': addIntakeAssets,

  'pieces.confirmIntake': confirmIntake,

  'pieces.update': async (ctx, { id, origin, ...patch }) => {
    const current = await getPiece(ctx, id)
    if (origin !== undefined && ctx.actor.type !== 'user')
      assertOnlyAdds(current.origin ?? null, origin)
    await ensure(getCollection, ctx, patch.collectionId)
    if (patch.coverAssetId) await getAssetRow(ctx, patch.coverAssetId)
    const [row] = await ctx.repo.pieces.update(eq(t.piece.id, id), {
      ...patch,
      // Choosing a cover by hand stops automatic capture, unless the capture itself is writing.
      coverAuto: patch.coverAuto ?? (patch.coverAssetId !== undefined ? false : undefined),
      ...(origin !== undefined
        ? { origin: origin && (await toOrigin(ctx, origin, current.origin ?? null)) }
        : {}),
      updatedAt: new Date(),
    })
    publish(ctx, { type: 'piece.updated', pieceId: id })
    // A person's choice of cover: a new one, or the one the server put there on its own (the
    // first finished take) now chosen by hand, which keeps it.
    const chosen =
      patch.coverAssetId &&
      patch.coverAuto !== true &&
      (patch.coverAssetId !== current.coverAssetId || current.coverAuto)
    if (chosen) await noteCover(ctx, id, patch.coverAssetId!)
    return toPieceSummary(row!)
  },

  'pieces.attest': async (ctx, { id, rights, likenessConsent }) => {
    if (ctx.actor.type !== 'user')
      throw forbidden('Only a person can attest to the rights in a source')
    const piece = await getPiece(ctx, id)
    if (!piece.origin)
      throw conflict('This piece was not made from a source, so there is nothing to attest')
    if (piece.origin.flags.some((f) => f.code === 'face') && !likenessConsent)
      throw badRequest(
        'The source shows a person: confirm you have their consent (likenessConsent)',
      )
    const origin: PieceOrigin = {
      ...piece.origin,
      attestation: { rights, likenessConsent, by: ctx.user.id, at: new Date().toISOString() },
    }
    const [row] = await ctx.repo.pieces.update(eq(t.piece.id, id), {
      origin,
      updatedAt: new Date(),
    })
    publish(ctx, { type: 'piece.updated', pieceId: id })
    return toPiece(ctx, row!)
  },

  'pieces.setSpec': async (ctx, { id, spec }) => {
    const piece = await getPiece(ctx, id)
    const [row] = await ctx.repo.pieces.update(eq(t.piece.id, id), {
      spec,
      // The spec says what the piece is: a ring respecified as a pendant becomes a pendant.
      kind: spec.kind,
      stage: advance(piece.stage, 'spec'),
      updatedAt: new Date(),
    })
    publish(ctx, { type: 'piece.updated', pieceId: id })
    return toPieceSummary(row!)
  },

  'pieces.buildFromSpec': async (ctx, { id }) => {
    const piece = await getPiece(ctx, id)
    if (!piece.spec)
      throw conflict('This piece has no saved spec yet; save one with pieces.setSpec first')
    const built = buildDesign(piece.spec)
    // An empty build is a failure, not a success with nothing in it: the design stays as it was.
    const empty = emptyBuildReason(piece.spec, built)
    if (empty) throw conflict(empty)
    const ops = replaceDesignOps(piece.design, built)
    const { version } =
      ops.length === 0
        ? { version: piece.version }
        : await commitChange(ctx, {
            pieceId: id,
            ops,
            label: 'Build from spec',
            baseVersion: piece.version,
          })
    const [row] = await ctx.repo.pieces.update(eq(t.piece.id, id), {
      stage: advance(piece.stage, 'design'),
    })
    return { version, design: row!.design }
  },

  'pieces.duplicate': async (ctx, { id, title }) => {
    const source = await getPiece(ctx, id)
    return insertPiece(ctx, {
      title: title ?? `${source.title} (copy)`.slice(0, 120),
      kind: source.kind,
      stage: source.stage,
      brief: source.brief,
      spec: source.spec,
      design: source.design,
      collectionId: source.collectionId,
      coverAssetId: source.coverAssetId,
      coverAuto: source.coverAuto,
      origin: source.origin,
    })
  },

  // A .pave file is free both ways: nothing here claims from the plan's allowance.
  'pieces.saveFile': async (ctx, { id }) => {
    const file = await savePieceFile(ctx, id)
    const asset = await putAsset(ctx, {
      bytes: file.bytes,
      name: file.name,
      mime: PAVE_MIME,
      kind: 'archive',
    })
    return { asset, notes: file.notes }
  },

  'pieces.openFile': async (ctx, { assetId, collectionId }) => {
    const row = await getAssetRow(ctx, assetId)
    return openPieceFile(ctx, await assetBytes(ctx, row), row.name, { collectionId })
  },

  'pieces.estimate': (ctx, input) => estimateSpec(ctx, input),
  'pieces.takeToCad': (ctx, input) => takeToCad(ctx, input),
  'pieces.openAsCad': (ctx, input) => openAsCad(ctx, input),

  'pieces.proposeDirections': (ctx, input) => proposeDirections(ctx, input),
  'pieces.chooseDirection': (ctx, input) => chooseDirection(ctx, input),
  'pieces.removeDirection': (ctx, input) => removeDirection(ctx, input),

  'pieces.delete': async (ctx, { id }) => {
    await getPiece(ctx, id)
    await cancelLiveJobs(ctx, id)
    await ctx.repo.pieces.delete(eq(t.piece.id, id))
    publish(ctx, { type: 'piece.updated', pieceId: id })
    return { ok: true }
  },
}
