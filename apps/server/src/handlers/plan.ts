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

  // The studio exports in the browser, so it asks first: the server still decides what counts.
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
    const settled = await settle(ctx, row.idempotencyKey, delivered ? 'used' : 'released')
    if (!settled) throw conflict(`That claim is already ${row.state}`)
    return planStatus(ctx)
  },
}
