/**
 * A piece's pinned references live on one board of their own (`board.pins_for`), so pinning,
 * reordering and removing reuse the boards' trusted saving, provenance and rights. The board is
 * created on the first pin; the unique index on `pins_for` settles two windows pinning at once.
 */
import { asc, eq } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { createId } from '../ids'

type BoardRow = typeof t.board.$inferSelect

export const pinBoardOf = (ctx: Ctx, pieceId: string): Promise<BoardRow | undefined> =>
  ctx.repo.boards.first(eq(t.board.pinsFor, pieceId))

export async function ensurePinBoard(
  ctx: Ctx,
  piece: { id: string; title: string },
): Promise<BoardRow> {
  const existing = await pinBoardOf(ctx, piece.id)
  if (existing) return existing
  const made = await ctx.repo.boards.insertIfAbsent({
    id: createId('brd'),
    title: `Pinned for ${piece.title}`.slice(0, 120),
    description: 'References pinned beside CAD.',
    icon: '📌',
    pieceId: null,
    pinsFor: piece.id,
  })
  // Lost the race: the other window's board is the piece's board.
  return made ?? (await pinBoardOf(ctx, piece.id))!
}

/** The piece's pins in the designer's order (empty before the first pin). */
export async function pinnedRows(ctx: Ctx, pieceId: string) {
  const board = await pinBoardOf(ctx, pieceId)
  if (!board) return []
  return ctx.repo.references.many({
    where: eq(t.reference.boardId, board.id),
    orderBy: asc(t.reference.position),
  })
}
