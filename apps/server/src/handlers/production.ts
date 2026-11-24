import type { ProductionPackage } from '@pave/schema'
import { desc, eq, max } from 'drizzle-orm'
import * as t from '../db/schema'
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
