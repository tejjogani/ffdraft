import type { Op } from '@pave/schema'
import { and, desc, eq, lt } from 'drizzle-orm'
import { putAsset } from '../assets/assets'
import * as t from '../db/schema'
import { commitChange, storeFacts, toStoredChange } from '../design'
import { notFound } from '../errors'
import { getPiece } from '../lookups'
import { serviceContext } from '../service-context'
import { assertAttested } from './pieces'
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
      reverts: input.reverts,
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

  // A run reverts as one change: the inverses of its changes, newest first.
  'design.revert': async (ctx, input) => {
    await getPiece(ctx, input.pieceId)
    const onPiece = eq(t.designChange.pieceId, input.pieceId)
    const targets = await ctx.repo.changes.many({
      where:
        input.runId !== undefined
          ? and(onPiece, eq(t.designChange.runId, input.runId))
          : and(onPiece, eq(t.designChange.seq, input.seq!)),
      orderBy: desc(t.designChange.seq),
    })
    if (targets.length === 0)
      throw input.runId !== undefined
        ? notFound(`Changes by run "${input.runId}" to piece`, input.pieceId)
        : notFound(`Change ${input.seq} of piece`, input.pieceId)
    const label =
      input.runId !== undefined
        ? `Undo assistant edits: ${targets
            .map((c) => c.label)
            .toReversed()
            .join('; ')}`
        : `Revert: ${targets[0]!.label}`
    return commitChange(ctx, {
      pieceId: input.pieceId,
      ops: targets.flatMap((c) => c.inverse),
      label: label.length > 200 ? `${label.slice(0, 199)}…` : label,
      reverts: targets.map((c) => c.id),
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
    assertAttested(piece)
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
