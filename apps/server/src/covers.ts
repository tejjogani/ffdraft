/**
 * Clay covers: a piece that has been built but never pictured gets a picture of its own
 * geometry, drawn on the server by the kernel's software rasteriser and tinted with the piece's
 * metal, so cards and the overview show the jewellery from the first moment — the welcome
 * workspace's examples, a piece the assistant built while no window was open, a piece opened on
 * a machine whose browser draws in software (where the studio's own capture is skipped).
 *
 * Drawn once, when the piece has no cover at all: redrawing on every edit would pile up assets.
 * The cover stays automatic, so the studio's viewport capture and the first finished render
 * replace it (see `isClayCover`); a cover a person chose is never touched.
 */
import { type Design, type EvaluationSummary, METALS, type MetalId } from '@pave/schema'
import { and, eq, isNull } from 'drizzle-orm'
import sharp from 'sharp'
import { putAsset } from './assets/assets'
import { type Ctx, publish } from './context'
import * as t from './db/schema'
import { serviceContext } from './service-context'

/** The cover's side in pixels: what a card and the overview show, with room for a retina card. */
export const COVER_PX = 768
/** Drawn at twice the size and scaled down: the rasteriser does not smooth its edges. */
const SUPERSAMPLE = 2
/** Clay covers are recognised by name, so a render can take their place. */
const CLAY_PREFIX = 'cover-clay-'

export const isClayCover = (assetName: string) => assetName.startsWith(CLAY_PREFIX)

/**
 * The metal's swatch, darkened a little: the rasteriser brightens lit faces by up to 15%, and a
 * white metal at full swatch would fade into the light ground.
 */
function metalTint(summary: EvaluationSummary): [number, number, number] | undefined {
  const main = summary.metals.toSorted((a, b) => b.massG - a.massG)[0]?.material
  if (!main || !(main in METALS)) return undefined
  const hex = METALS[main as MetalId].swatch
  return [1, 3, 5].map((i) => Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * 0.86)) as [
    number,
    number,
    number,
  ]
}

/**
 * Draws and sets a clay cover when the piece at `version` has content and no cover. Called after
 * the piece's facts are stored (so `summary` is the current version's); a newer version, or a
 * cover set meanwhile by anyone, wins over this picture.
 */
export async function drawClayCover(
  ctx: Ctx,
  pieceId: string,
  version: number,
  design: Design,
  summary: EvaluationSummary,
): Promise<void> {
  const geometry = ctx.services.get('geometry')
  if (!geometry.picture || design.order.length === 0) return
  if (summary.metals.length === 0 && summary.stoneCount === 0) return
  const row = await ctx.repo.pieces.first(eq(t.piece.id, pieceId))
  if (!row?.coverAuto || row.coverAssetId || row.version !== version) return

  const size = COVER_PX * SUPERSAMPLE
  const metal = metalTint(summary)
  const { images } = await geometry.picture(
    design,
    { views: ['hero'], size, focus: [], pieceId, background: true, ...(metal ? { metal } : {}) },
    serviceContext(ctx),
  )
  const rgba = images[0]
  if (!rgba) return
  // sharp scales on its own threads, off the event loop.
  const png = await sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
    .resize(COVER_PX, COVER_PX, { kernel: 'lanczos3' })
    .png()
    .toBuffer()
  const asset = await putAsset(ctx, {
    bytes: new Uint8Array(png.buffer, png.byteOffset, png.byteLength),
    name: `${CLAY_PREFIX}v${version}.png`,
    kind: 'image',
  })
  const set = await ctx.repo.pieces.update(
    and(
      eq(t.piece.id, pieceId),
      eq(t.piece.version, version),
      eq(t.piece.coverAuto, true),
      isNull(t.piece.coverAssetId),
    )!,
    { coverAssetId: asset.id },
  )
  if (set.length) publish(ctx, { type: 'piece.updated', pieceId })
}
