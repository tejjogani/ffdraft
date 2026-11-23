import {
  buildDesign,
  type Design,
  emptyDesign,
  type Piece,
  type PieceKind,
  type PieceSpec,
  PieceSpecSchema,
  type PieceSummary,
  STAGES,
  type Stage,
  TEMPLATES,
} from '@pave/schema'
import { and, desc, eq, ilike, isNull, type SQL } from 'drizzle-orm'
import { getAssetRow } from '../assets/assets'
import { type Ctx, publish } from '../context'
import * as t from '../db/schema'
import { commitChange, refreshFacts, replaceDesignOps } from '../design'
import { badRequest, conflict } from '../errors'
import { createId } from '../ids'
import { ensure, getCollection, getPiece } from '../lookups'
import type { HandlerGroup } from './types'

type PieceRow = typeof t.piece.$inferSelect

export const toPieceSummary = (r: PieceRow): PieceSummary => ({
  id: r.id,
  title: r.title,
  kind: r.kind,
  stage: r.stage,
  collectionId: r.collectionId,
  coverAssetId: r.coverAssetId,
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
    design: r.design,
    version: r.version,
    boardIds: boards.map((b) => b.id),
  }
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

  'pieces.get': async (ctx, { id }) => toPiece(ctx, await getPiece(ctx, id)),

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
    })
  },

  'pieces.update': async (ctx, { id, ...patch }) => {
    await getPiece(ctx, id)
    await ensure(getCollection, ctx, patch.collectionId)
    if (patch.coverAssetId) await getAssetRow(ctx, patch.coverAssetId)
    const [row] = await ctx.repo.pieces.update(eq(t.piece.id, id), {
      ...patch,
      updatedAt: new Date(),
    })
    publish(ctx, { type: 'piece.updated', pieceId: id })
    return toPieceSummary(row!)
  },

  'pieces.setSpec': async (ctx, { id, spec }) => {
    const piece = await getPiece(ctx, id)
    const [row] = await ctx.repo.pieces.update(eq(t.piece.id, id), {
      spec,
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
    const ops = replaceDesignOps(piece.design, buildDesign(piece.spec))
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
    })
  },

  'pieces.delete': async (ctx, { id }) => {
    await getPiece(ctx, id)
    await ctx.repo.pieces.delete(eq(t.piece.id, id))
    publish(ctx, { type: 'piece.updated', pieceId: id })
    return { ok: true }
  },
}
