import { exportCounts } from '@pave/schema'
import { conflict, forbidden } from '../errors'
import { getPiece } from '../lookups'
import { claim, getClaim, planStatus, releaseStale, settle } from '../plans'
import { assertAttested } from './pieces'
import type { HandlerGroup } from './types'

export const plan: HandlerGroup<'plan'> = {
  // Settings and the Upgrade screen show what is really held: abandoned export claims go first.
  'plan.get': async (ctx) => {
    await releaseStale(ctx)
    return planStatus(ctx)
  },

  // A client that exports on its own asks first. The studio exports Rhino and STEP through
  // design.export instead, where the server does the work and counts only what it delivered.
  'plan.claim': async (ctx, { pieceId, format, key }) => {
    const piece = await getPiece(ctx, pieceId)
    assertAttested(piece)
    if (!exportCounts(format)) return { claimId: null, counted: false, plan: await planStatus(ctx) }
    const row = await claim(ctx, {
      allowance: 'export',
      // Scoped to the person, so two people's studio-made keys can never meet.
      key: `browser:${ctx.user.id}:${key}`,
      subject: format,
      pieceId,
    })
    return { claimId: row.id, counted: true, plan: await planStatus(ctx) }
  },

  'plan.settle': async (ctx, { claimId, delivered }) => {
    const row = await getClaim(ctx, claimId)
    if (row.userId !== ctx.user.id) throw forbidden('That claim is someone else’s')
    // The server cannot know whether a file made outside it was saved: a client giving the slot
    // back would make the allowance endless (claim, export, give back). Only a failed server
    // export (design.export) returns a slot.
    if (!delivered)
      throw conflict(
        'An export claim cannot be given back. A Rhino or STEP export that fails on the server is never counted.',
      )
    const settled = await settle(ctx, row.idempotencyKey, 'used')
    if (!settled) throw conflict(`That claim is already ${row.state}`)
    return planStatus(ctx)
  },
}
