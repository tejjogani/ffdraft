/**
 * The one rule for what Claude may see: a picture shown by a view-only reference is inspiration
 * for people only. Its pixels are never sent to a model (a turn, a photo read) and never fitted
 * to (match.fit), whoever asks; its details (title, credit, licence) may be.
 *
 * An asset counts as view-only when any reference showing it is view-only (the person's own
 * choice included), or when the server fetched it from the web and no reference vouches for it
 * any more (the rule `references.save` applies to captured pixels).
 */
import { inArray } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { forbidden } from '../errors'

export async function viewOnlyAssets(ctx: Ctx, assetIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(assetIds)]
  if (!ids.length) return new Set()
  const [assets, refs] = await Promise.all([
    ctx.repo.assets.many({ where: inArray(t.asset.id, ids) }),
    ctx.repo.references.many({ where: inArray(t.reference.assetId, ids) }),
  ])
  const out = new Set<string>()
  for (const a of assets) {
    const showing = refs.filter((r) => r.assetId === a.id)
    if (showing.some((r) => r.rights === 'viewOnly') || (a.capturedFrom && !showing.length))
      out.add(a.id)
  }
  return out
}

export const VIEW_ONLY_REFUSAL =
  'is a view-only reference: it can be shown in the studio, but its picture cannot be sent to AI or fitted to. Ask the designer for a picture they may use.'

/** Throws when any of the assets is view-only; used before a picture would leave for a model. */
export async function assertSendable(
  ctx: Ctx,
  assetIds: readonly string[],
  nameOf: (id: string) => string = (id) => id,
): Promise<void> {
  const blocked = await viewOnlyAssets(ctx, assetIds)
  const first = assetIds.find((id) => blocked.has(id))
  if (first) throw forbidden(`${nameOf(first)} ${VIEW_ONLY_REFUSAL}`)
}
