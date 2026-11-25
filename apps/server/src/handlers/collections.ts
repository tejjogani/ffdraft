import { type Collection, MAX_FOLDER_DEPTH } from '@pave/schema'
import { asc, count, eq, isNotNull, max } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { badRequest } from '../errors'
import { createId } from '../ids'
import { getCollection } from '../lookups'
import type { HandlerGroup } from './types'

async function pieceCounts(ctx: Ctx, collectionId?: string): Promise<Map<string, number>> {
  const rows = await ctx.repo.pieces
    .select(
      { collectionId: t.piece.collectionId, n: count() },
      collectionId ? eq(t.piece.collectionId, collectionId) : isNotNull(t.piece.collectionId),
    )
    .groupBy(t.piece.collectionId)
  return new Map(rows.map((r) => [r.collectionId!, r.n]))
}

const toCollection = (
  r: typeof t.collection.$inferSelect,
  counts: Map<string, number>,
): Collection => ({
  id: r.id,
  name: r.name,
  icon: r.icon,
  position: r.position,
  parentId: r.parentId,
  pieceCount: counts.get(r.id) ?? 0,
})

/**
 * Checks a folder may sit in `parentId`: the parent exists and is at the top level, and the
 * folder being moved holds no folders itself, so the tree stays MAX_FOLDER_DEPTH (two) deep and
 * a folder can never end up inside itself.
 */
async function assertParent(ctx: Ctx, parentId: string | null | undefined, movingId?: string) {
  if (!parentId) return
  if (parentId === movingId) throw badRequest('A folder cannot go inside itself')
  const parent = await getCollection(ctx, parentId)
  if (parent.parentId !== null)
    throw badRequest(
      `Folders go ${MAX_FOLDER_DEPTH} levels deep at most: “${parent.name}” is already inside another folder`,
    )
  if (movingId) {
    const [child] = await ctx.repo.collections.select(
      { id: t.collection.id },
      eq(t.collection.parentId, movingId),
    )
    if (child)
      throw badRequest(
        `Folders go ${MAX_FOLDER_DEPTH} levels deep at most: this folder holds folders, so it stays at the top`,
      )
  }
}

export const collections: HandlerGroup<'collections'> = {
  'collections.list': async (ctx) => {
    const [rows, counts] = await Promise.all([
      ctx.repo.collections.many({
        orderBy: [asc(t.collection.position), asc(t.collection.createdAt)],
      }),
      pieceCounts(ctx),
    ])
    return rows.map((r) => toCollection(r, counts))
  },

  'collections.create': async (ctx, input) => {
    await assertParent(ctx, input.parentId)
    const [last] = await ctx.repo.collections.select({ position: max(t.collection.position) })
    const row = await ctx.repo.collections.insert({
      id: createId('col'),
      name: input.name,
      icon: input.icon ?? null,
      parentId: input.parentId ?? null,
      position: (last?.position ?? 0) + 1,
    })
    return toCollection(row, new Map())
  },

  'collections.update': async (ctx, { id, ...patch }) => {
    await getCollection(ctx, id)
    await assertParent(ctx, patch.parentId, id)
    const [row] = await ctx.repo.collections.update(eq(t.collection.id, id), {
      ...patch,
      updatedAt: new Date(),
    })
    return toCollection(row!, await pieceCounts(ctx, id))
  },

  'collections.delete': async (ctx, { id }) => {
    await getCollection(ctx, id)
    // The foreign keys un-file the folder's projects and move its sub-folders to the top level
    // (ON DELETE SET NULL on both).
    await ctx.repo.collections.delete(eq(t.collection.id, id))
    return { ok: true }
  },
}
