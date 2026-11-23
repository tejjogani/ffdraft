import type { Collection } from '@pave/schema'
import { asc, count, eq, isNotNull, max } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
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
  pieceCount: counts.get(r.id) ?? 0,
})

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
    const [last] = await ctx.repo.collections.select({ position: max(t.collection.position) })
    const row = await ctx.repo.collections.insert({
      id: createId('col'),
      name: input.name,
      icon: input.icon ?? null,
      position: (last?.position ?? 0) + 1,
    })
    return toCollection(row, new Map())
  },

  'collections.update': async (ctx, { id, ...patch }) => {
    await getCollection(ctx, id)
    const [row] = await ctx.repo.collections.update(eq(t.collection.id, id), {
      ...patch,
      updatedAt: new Date(),
    })
    return toCollection(row!, await pieceCounts(ctx, id))
  },

  'collections.delete': async (ctx, { id }) => {
    await getCollection(ctx, id)
    // The foreign key un-files the collection's pieces (ON DELETE SET NULL).
    await ctx.repo.collections.delete(eq(t.collection.id, id))
    return { ok: true }
  },
}
