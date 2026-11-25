/**
 * Pictures as the model reads them: photos attached to a message and the views a capture took.
 * Claude reads images up to about 1568 px on the long edge without downscaling them itself, so
 * larger ones are resized here (fewer tokens, same detail) and kept in their format.
 */
import type { ShapeImage } from '@pave/agent'
import sharp from 'sharp'

/** The long edge Claude's vision works at without resizing. */
export const MODEL_LONG_EDGE = 1568

const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/webp'])

export const isModelImage = (mime: string) => SUPPORTED.has(mime)

export interface ModelImage {
  mediaType: ShapeImage['mediaType']
  /** Base64, no data: prefix. */
  data: string
}

/** The image resized for the model, or null for a format it cannot read (HEIC, SVG, …). */
export async function modelImage(bytes: Uint8Array, mime: string): Promise<ModelImage | null> {
  if (!isModelImage(mime)) return null
  const format = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpeg'
  // `rotate()` applies the EXIF orientation, so a phone photo is seen the right way up.
  const out = await sharp(bytes)
    .rotate()
    .resize({
      width: MODEL_LONG_EDGE,
      height: MODEL_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toFormat(format)
    .toBuffer()
  return { mediaType: mime as ModelImage['mediaType'], data: out.toString('base64') }
}
