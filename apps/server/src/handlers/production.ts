import type { Design, ProductionPackage } from '@pave/schema'
import { desc, eq, max } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { conflict } from '../errors'
import { createId } from '../ids'
import { packageHandle } from '../jobs'
import { getPiece } from '../lookups'
import { publishJob, serviceContext } from '../service-context'
import { assertAttested, toPiece } from './pieces'
import type { HandlerGroup } from './types'

export const toPackage = (r: typeof t.productionPackage.$inferSelect): ProductionPackage => ({
  id: r.id,
  pieceId: r.pieceId,
  revision: r.revision,
  sourceVersion: r.sourceVersion,
  status: r.status,
  assetId: r.assetId,
  manifest: r.manifest ?? null,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
})

/**
 * Refuses (409) a piece with nothing to make while the caller is still waiting, rather than
 * queuing a package that can only fail in the background. Draft detail: fast, and enough to see
 * whether there is any metal or stone at all.
 */
async function assertProducible(ctx: Ctx, piece: { id: string; design: Design }): Promise<void> {
  if (!ctx.services.isConfigured('geometry')) return
  // Only a definite answer refuses; if the check itself fails, the build reports why.
  const draft = await ctx.services
    .get('geometry')
    .evaluate(piece.design, { detail: 'draft', pieceId: piece.id }, serviceContext(ctx))
    .catch(() => null)
  if (draft && draft.metalMassG === 0 && draft.stoneCount === 0)
    throw conflict('Nothing to produce: the piece has no metal or stones.')
}

export const production: HandlerGroup<'production'> = {
  'production.list': async (ctx, { pieceId }) => {
    await getPiece(ctx, pieceId)
    const rows = await ctx.repo.packages.many({
      where: eq(t.productionPackage.pieceId, pieceId),
      orderBy: desc(t.productionPackage.revision),
    })
    return rows.map(toPackage)
  },

  'production.create': async (ctx, { pieceId, ...request }) => {
    const packager = ctx.services.require('production')
    const piece = await getPiece(ctx, pieceId)
    assertAttested(piece)
    await assertProducible(ctx, piece)
    const [last] = await ctx.repo.packages.select(
      { revision: max(t.productionPackage.revision) },
      eq(t.productionPackage.pieceId, pieceId),
    )
    const row = await ctx.repo.packages.insert({
      id: createId('pkg'),
      pieceId,
      revision: (last?.revision ?? 0) + 1,
      sourceVersion: piece.version,
      status: 'queued',
      request,
      createdBy: ctx.user.id,
    })
    const pkg = toPackage(row)
    const job = { kind: 'production' as const, id: pkg.id, pieceId }
    const handle = packageHandle(ctx, job)
    publishJob(ctx, job, { status: 'queued', progress: 0 })
    try {
      await packager.submit(
        pkg,
        { piece: await toPiece(ctx, piece), ...request },
        handle,
        serviceContext(ctx),
      )
    } catch (err) {
      // Never leave a package queued for ever behind an engine that refused it.
      await handle.update({ status: 'failed' })
      throw err
    }
    return pkg
  },
}
