import type { ProductionPackage } from '@pave/schema'
import { desc, eq, max } from 'drizzle-orm'
import * as t from '../db/schema'
import { createId } from '../ids'
import { getPiece } from '../lookups'
import { jobHandle, publishJob, serviceContext, stepProgress } from '../service-context'
import type { ProductionPackagePatch } from '../services'
import { assertAttested, toPiece } from './pieces'
import type { HandlerGroup } from './types'

const toPackage = (r: typeof t.productionPackage.$inferSelect): ProductionPackage => ({
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
      createdBy: ctx.user.id,
    })
    const pkg = toPackage(row)
    const job = { kind: 'production' as const, id: pkg.id, pieceId }
    const handle = jobHandle<ProductionPackagePatch>(ctx, job, async (patch) => {
      const [row] = await ctx.repo.packages.update(eq(t.productionPackage.id, pkg.id), patch)
      return row && { status: row.status, progress: stepProgress(row.status) }
    })
    publishJob(ctx, job, { status: 'queued', progress: 0 })
    await packager.submit(
      pkg,
      { piece: await toPiece(ctx, piece), ...request },
      handle,
      serviceContext(ctx),
    )
    return pkg
  },
}
