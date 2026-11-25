/**
 * Photos of pieces as pixels: decoded with `sharp` (EXIF orientation applied, so a phone photo is
 * the right way up), scaled to a working size, and cut out with `@pave/match`'s classical matte
 * when the background is plain. Used by `references.read` (does a cut-out work here?) and by
 * `match.fit` (the outline it fits to). Decoding runs on sharp's own threads; the matte is a
 * few linear passes over at most `FIT_EDGE`² pixels.
 */
import { type MatteResult, subjectMatte } from '@pave/match'
import sharp from 'sharp'
import { readAsset } from './assets/assets'
import type { Ctx } from './context'
import { badRequest } from './errors'

/** The long edge a photo is fitted at: past the fit's own fine stage (384 px), well under a phone's. */
export const FIT_EDGE = 512

export interface PhotoPixels {
  rgba: Uint8Array
  width: number
  height: number
}

/** RGBA pixels of an image, its long edge at most `maxEdge`. */
export async function photoPixels(bytes: Uint8Array, maxEdge = FIT_EDGE): Promise<PhotoPixels> {
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  }
}

/** The matte of a stored photo, with whether its background is plain enough to trust it. */
export async function photoMatte(
  ctx: Ctx,
  assetId: string,
): Promise<MatteResult & { width: number; height: number }> {
  const { asset, bytes } = await readAsset(ctx, assetId)
  if (asset.kind !== 'image') throw badRequest(`${asset.name} is not a picture`)
  const px = await photoPixels(bytes)
  return { ...subjectMatte(px.rgba, px), width: px.width, height: px.height }
}

/** PNG bytes of RGBA pixels. */
export async function pngOf(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}
