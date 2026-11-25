import type { Design, ProductionPackage } from '@pave/schema'
import { desc, eq, max } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { conflict, isUniqueViolation } from '../errors'
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

const REVISION_ATTEMPTS = 8

/**
 * Inserts the package as the piece's next revision. Two requests at once (a double click) read
 * the same last revision; the unique index lets one in and the other takes the number after it.
 */
async function insertNextRevision(
  ctx: Ctx,
  piece: { id: string; version: number },
  request: (typeof t.productionPackage.$inferInsert)['request'],
) {
  for (let attempt = 1; ; attempt++) {
    const [last] = await ctx.repo.packages.select(
      { revision: max(t.productionPackage.revision) },
      eq(t.productionPackage.pieceId, piece.id),
    )
    try {
      return await ctx.repo.packages.insert({
        id: createId('pkg'),
        pieceId: piece.id,
        revision: (last?.revision ?? 0) + 1,
        sourceVersion: piece.version,
        status: 'queued',
        request,
        createdBy: ctx.user.id,
      })
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      if (attempt >= REVISION_ATTEMPTS)
        throw conflict('Other packages of this piece are being queued right now; try again')
    }
  }
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
    const pkg = toPackage(await insertNextRevision(ctx, piece, request))
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
