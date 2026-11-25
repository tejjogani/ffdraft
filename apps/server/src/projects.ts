/**
 * Projects and folders, as costs. A project is a piece, presented as three stages (its design
 * board, its CAD, its renders); a folder is a collection, which may sit in one other folder.
 * This module only reads: every number comes from the usage ledger (Claude runs and image
 * generations, each row carrying its piece and stage), the plan's claims (Blender renders and
 * Rhino/STEP exports, each carrying its piece) and what each stage holds.
 *
 * Money is all-time per project; the plan's counts are all-time too (the plan page shows the
 * month). A claim given back (the work failed or was cancelled) is not counted.
 */
import type { FolderTotal, JobStage, ProjectCost, StageCost } from '@pave/schema'
import { and, count, eq, inArray, isNotNull, isNull, sum } from 'drizzle-orm'
import type { Ctx } from './context'
import * as t from './db/schema'
import { fromMicros } from './usage'

/** How many projects one summary covers; a folder page or the projects list stays within it. */
export const SUMMARY_LIMIT = 500

const emptyStage = (): StageCost => ({
  aiUsd: 0,
  imageUsd: 0,
  rendersUsed: 0,
  exportsUsed: 0,
  items: 0,
})

const emptyProject = (pieceId: string): ProjectCost => ({
  pieceId,
  design: emptyStage(),
  cad: emptyStage(),
  render: emptyStage(),
  otherUsd: 0,
  totalUsd: 0,
})

const round = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000

/** The projects a summary is about: given ids, a folder with its sub-folders, or all of them. */
async function scope(
  ctx: Ctx,
  input: { collectionId?: string | null; pieceIds?: string[] },
): Promise<string[]> {
  if (input.pieceIds) {
    if (!input.pieceIds.length) return []
    const rows = await ctx.repo.pieces.select(
      { id: t.piece.id },
      inArray(t.piece.id, input.pieceIds),
    )
    return rows.map((r) => r.id)
  }
  if (input.collectionId === null) {
    const rows = await ctx.repo.pieces
      .select({ id: t.piece.id }, isNull(t.piece.collectionId))
      .limit(SUMMARY_LIMIT)
    return rows.map((r) => r.id)
  }
  if (input.collectionId) {
    const children = await ctx.repo.collections.select(
      { id: t.collection.id },
      eq(t.collection.parentId, input.collectionId),
    )
    const folders = [input.collectionId, ...children.map((c) => c.id)]
    const rows = await ctx.repo.pieces
      .select({ id: t.piece.id }, inArray(t.piece.collectionId, folders))
      .limit(SUMMARY_LIMIT)
    return rows.map((r) => r.id)
  }
  const rows = await ctx.repo.pieces.select({ id: t.piece.id }).limit(SUMMARY_LIMIT)
  return rows.map((r) => r.id)
}

/** Items on each piece's design boards (every board linked to it; its pin board belongs to CAD). */
async function boardItemCounts(ctx: Ctx, pieceIds: string[]): Promise<Map<string, number>> {
  const boards = await ctx.repo.boards.select(
    { id: t.board.id, pieceId: t.board.pieceId },
    and(inArray(t.board.pieceId, pieceIds), isNull(t.board.pinsFor)),
  )
  const out = new Map<string, number>()
  if (!boards.length) return out
  const counts = await ctx.repo.references
    .select(
      { boardId: t.reference.boardId, n: count() },
      inArray(
        t.reference.boardId,
        boards.map((b) => b.id),
      ),
    )
    .groupBy(t.reference.boardId)
  const pieceOf = new Map(boards.map((b) => [b.id, b.pieceId!]))
  for (const c of counts) {
    const pieceId = pieceOf.get(c.boardId)!
    out.set(pieceId, (out.get(pieceId) ?? 0) + c.n)
  }
  return out
}

/** Stage by stage costs and contents for each project. */
export async function projectCosts(ctx: Ctx, pieceIds: string[]): Promise<ProjectCost[]> {
  if (!pieceIds.length) return []
  const byId = new Map(pieceIds.map((id) => [id, emptyProject(id)]))
  const [spend, claims, boardItems, changes, takes] = await Promise.all([
    ctx.repo.usage
      .select(
        {
          pieceId: t.usageEvent.pieceId,
          stage: t.usageEvent.stage,
          meter: t.usageEvent.meter,
          micros: sum(t.usageEvent.costMicros).mapWith(Number),
        },
        inArray(t.usageEvent.pieceId, pieceIds),
      )
      .groupBy(t.usageEvent.pieceId, t.usageEvent.stage, t.usageEvent.meter),
    // A claim holds a slot while the work runs and once it is delivered; given back, it has none.
    ctx.repo.planClaims
      .select(
        { pieceId: t.planClaim.pieceId, allowance: t.planClaim.allowance, n: count() },
        and(inArray(t.planClaim.pieceId, pieceIds), isNotNull(t.planClaim.slot)),
      )
      .groupBy(t.planClaim.pieceId, t.planClaim.allowance),
    boardItemCounts(ctx, pieceIds),
    ctx.repo.changes
      .select(
        { pieceId: t.designChange.pieceId, n: count() },
        inArray(t.designChange.pieceId, pieceIds),
      )
      .groupBy(t.designChange.pieceId),
    ctx.repo.renders
      .select(
        { pieceId: t.renderJob.pieceId, n: count() },
        and(inArray(t.renderJob.pieceId, pieceIds), eq(t.renderJob.status, 'done')),
      )
      .groupBy(t.renderJob.pieceId),
  ])
  for (const row of spend) {
    const p = row.pieceId ? byId.get(row.pieceId) : undefined
    if (!p) continue
    const usd = fromMicros(row.micros ?? 0)
    const stage = row.stage as JobStage | null
    if (!stage) p.otherUsd += usd
    else if (row.meter === 'image') p[stage].imageUsd += usd
    // Claude, and any other paid AI service (3D, embeddings), is the stage's AI spend.
    else p[stage].aiUsd += usd
  }
  for (const row of claims) {
    const p = row.pieceId ? byId.get(row.pieceId) : undefined
    if (!p) continue
    if (row.allowance === 'render') p.render.rendersUsed += row.n
    else p.cad.exportsUsed += row.n
  }
  for (const [pieceId, n] of boardItems) {
    const p = byId.get(pieceId)
    if (p) p.design.items += n
  }
  for (const row of changes) {
    const p = byId.get(row.pieceId)
    if (p) p.cad.items += row.n
  }
  for (const row of takes) {
    const p = row.pieceId ? byId.get(row.pieceId) : undefined
    if (p) p.render.items += row.n
  }
  for (const p of byId.values()) {
    for (const s of ['design', 'cad', 'render'] as const) {
      p[s].aiUsd = round(p[s].aiUsd)
      p[s].imageUsd = round(p[s].imageUsd)
    }
    p.otherUsd = round(p.otherUsd)
    p.totalUsd = round(
      p.otherUsd +
        (['design', 'cad', 'render'] as const).reduce((n, s) => n + p[s].aiUsd + p[s].imageUsd, 0),
    )
  }
  return [...byId.values()]
}

/** Every folder's totals: its own projects plus those of its sub-folders. */
export async function folderTotals(ctx: Ctx): Promise<FolderTotal[]> {
  const folders = await ctx.repo.collections.select({
    id: t.collection.id,
    parentId: t.collection.parentId,
  })
  if (!folders.length) return []
  const pieces = await ctx.repo.pieces.select(
    { id: t.piece.id, collectionId: t.piece.collectionId },
    isNotNull(t.piece.collectionId),
  )
  const costs = new Map(
    (
      await projectCosts(
        ctx,
        pieces.map((p) => p.id),
      )
    ).map((c) => [c.pieceId, c]),
  )
  const parentOf = new Map(folders.map((f) => [f.id, f.parentId]))
  const totals = new Map<string, FolderTotal>(
    folders.map((f) => [
      f.id,
      { collectionId: f.id, pieceCount: 0, totalUsd: 0, rendersUsed: 0, exportsUsed: 0 },
    ]),
  )
  for (const piece of pieces) {
    const cost = costs.get(piece.id)
    // A project counts in its folder and in the folder above (two levels at most).
    const chain = [piece.collectionId!, parentOf.get(piece.collectionId!) ?? null].filter(
      (id): id is string => !!id && totals.has(id),
    )
    for (const id of chain) {
      const f = totals.get(id)!
      f.pieceCount++
      if (!cost) continue
      f.totalUsd = round(f.totalUsd + cost.totalUsd)
      f.rendersUsed += cost.render.rendersUsed
      f.exportsUsed += cost.cad.exportsUsed
    }
  }
  return [...totals.values()]
}

export async function projectsSummary(
  ctx: Ctx,
  input: { collectionId?: string | null; pieceIds?: string[] },
): Promise<{ projects: ProjectCost[]; folders: FolderTotal[] }> {
  const ids = await scope(ctx, input)
  const [projects, folders] = await Promise.all([projectCosts(ctx, ids), folderTotals(ctx)])
  return { projects, folders }
}
