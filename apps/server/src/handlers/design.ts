import type { Op } from '@pave/schema'
import { and, desc, eq, lt } from 'drizzle-orm'
import { putAsset } from '../assets/assets'
import * as t from '../db/schema'
import { commitChange, storeFacts, toStoredChange } from '../design'
import { notFound } from '../errors'
import { getPiece } from '../lookups'
import { serviceContext } from '../service-context'
import type { HandlerGroup } from './types'

export const design: HandlerGroup<'design'> = {
  'design.apply': async (ctx, input) =>
    commitChange(ctx, {
      pieceId: input.pieceId,
      // The wire schema types `add.node` loosely; applyOps validates each node against NodeSchema.
      ops: input.ops as Op[],
      label: input.label,
      baseVersion: input.baseVersion,
      changeId: input.changeId,
    }),

  'design.history': async (ctx, input) => {
    await getPiece(ctx, input.pieceId)
    const cond = eq(t.designChange.pieceId, input.pieceId)
    const rows = await ctx.repo.changes.many({
      where: input.before === undefined ? cond : and(cond, lt(t.designChange.seq, input.before)),
      orderBy: desc(t.designChange.seq),
      limit: input.limit,
    })
    return rows.map(toStoredChange)
  },

  'design.revert': async (ctx, input) => {
    const target = await ctx.repo.changes.first(
      and(eq(t.designChange.pieceId, input.pieceId), eq(t.designChange.seq, input.seq)),
    )
    if (!target) throw notFound(`Change ${input.seq} of piece`, input.pieceId)
    return commitChange(ctx, {
      pieceId: input.pieceId,
      ops: target.inverse,
      label: `Revert: ${target.label}`.slice(0, 200),
      // Later edits may have touched the same nodes; that is a conflict, not a malformed request.
      invalidAs: 'conflict',
    })
  },

  'design.evaluate': async (ctx, input) => {
    const piece = await getPiece(ctx, input.pieceId)
    const summary = await ctx.services
      .get('geometry')
      .evaluate(piece.design, { detail: input.detail }, serviceContext(ctx))
    await storeFacts(ctx, piece.id, piece.version, summary)
    return summary
  },

  'design.export': async (ctx, input) => {
    const piece = await getPiece(ctx, input.pieceId)
    const { file, notes } = await ctx.services
      .get('geometry')
      .export(
        piece.design,
        { format: input.format, stones: input.stones ?? true },
        serviceContext(ctx),
      )
    const asset = await putAsset(ctx, { ...file, kind: 'mesh' })
    return { asset, notes }
  },
}
