import type { Piece, RenderJob } from '@pave/schema'
import { assetUrl } from '../../lib/assets'
import { rpc } from '../../lib/rpc'

type PhotoScope = Pick<Piece, 'id' | 'version'>
export type PhotoPiece = PhotoScope & Pick<Piece, 'title'>
export type Placement = { x: number; y: number; size: number; angle: number }
type Bounds = { x: number; y: number; width: number; height: number }
export type Cutout = { image: ImageBitmap; bounds: Bounds }

export const initialPlacement: Placement = { x: 50, y: 50, size: 25, angle: 0 }
const MAX_BYTES = 25 * 1024 * 1024

export function transparentTakeAsset(take: RenderJob, piece: PhotoScope): string | undefined {
  if (
    take.pieceId === piece.id &&
    take.sourceVersion === piece.version &&
    !take.stale &&
    take.purpose === 'take' &&
    take.status === 'done' &&
    take.scene.environment.background === 'transparent' &&
    !take.scene.animation
  ) {
    return take.assetIds[0]
  }
}

export async function verifyPhotoTake(piece: PhotoScope, takeId: string, assetId: string) {
  const take = await rpc.call('renders.get', { id: takeId })
  if (take.id !== takeId || transparentTakeAsset(take, piece) !== assetId) {
    throw new Error(
      'This take is no longer current. Choose a transparent still of the current CAD.',
    )
  }
}

function pngDimensions(bytes: DataView) {
  if (
    bytes.byteLength < 45 ||
    bytes.getUint32(0) !== 0x89504e47 ||
    bytes.getUint32(4) !== 0x0d0a1a0a ||
    bytes.getUint32(8) !== 13 ||
    bytes.getUint32(12) !== 0x49484452 // IHDR
  ) {
    return
  }
  let hasImageData = false
  for (let at = 33; at + 12 <= bytes.byteLength; ) {
    const length = bytes.getUint32(at)
    const next = at + 12 + length
    if (next > bytes.byteLength) return
    const type = bytes.getUint32(at + 4)
    if (type === 0x6163544c) return // acTL (animated PNG)
    if (type === 0x49444154) hasImageData = true // IDAT
    if (type === 0x49454e44) {
      // IEND
      if (hasImageData && length === 0 && next === bytes.byteLength)
        return { width: bytes.getUint32(16), height: bytes.getUint32(20) }
      return
    }
    at = next
  }
}

function jpegDimensions(bytes: DataView) {
  if (bytes.byteLength < 4 || bytes.getUint16(0) !== 0xffd8) return
  // Find the first frame header before the compressed image data.
  for (let at = 2; at + 4 <= bytes.byteLength; ) {
    if (bytes.getUint8(at++) !== 0xff) return
    while (at < bytes.byteLength && bytes.getUint8(at) === 0xff) at++
    if (at + 3 > bytes.byteLength) return
    const marker = bytes.getUint8(at++)
    const length = bytes.getUint16(at)
    if (length < 2 || at + length > bytes.byteLength || marker === 0xda) return
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length >= 8) return { width: bytes.getUint16(at + 5), height: bytes.getUint16(at + 3) }
      return
    }
    at += length
  }
}

async function decodeImage(blob: Blob, take: boolean): Promise<ImageBitmap> {
  if (blob.size > MAX_BYTES) throw new Error('Choose an image up to 25 MB.')
  const bytes = new DataView(await blob.arrayBuffer())
  const png = pngDimensions(bytes)
  const dimensions = png ?? (take ? undefined : jpegDimensions(bytes))
  const invalidImage = take
    ? 'The take does not contain a readable PNG. Render a new transparent still.'
    : 'Choose a readable JPEG or PNG photo.'
  if (!dimensions) throw new Error(invalidImage)
  const { width, height } = dimensions
  if (width <= 0 || height <= 0) throw new Error(invalidImage)
  if (width > 8192 || height > 8192 || width * height > 16_000_000) {
    throw new Error('Choose an image up to 16 megapixels and 8,192 pixels on each side.')
  }
  try {
    return await createImageBitmap(new Blob([blob], { type: png ? 'image/png' : 'image/jpeg' }), {
      imageOrientation: 'from-image',
    })
  } catch {
    throw new Error(invalidImage)
  }
}

export const readLocalPhoto = (file: File) => decodeImage(file, false)

async function fetchTakePng(assetId: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(assetUrl(encodeURIComponent(assetId)), {
    credentials: 'same-origin',
    redirect: 'error',
    signal,
  })
  if (!response.ok || !response.body) throw new Error('Could not load the take from Renders.')
  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return new Blob(chunks, { type: 'image/png' })
      total += value.byteLength
      if (total > MAX_BYTES) throw new Error('Choose a take up to 25 MB.')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

function cropTransparentImage(image: ImageBitmap): Bounds {
  const { width, height } = image
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Could not inspect the take on this device.')
    ctx.drawImage(image, 0, 0)
    let left = width
    let top = height
    let right = -1
    let bottom = -1
    let hasTransparentPixel = false
    for (let start = 0; start < height; start += 64) {
      const rows = Math.min(64, height - start)
      const { data } = ctx.getImageData(0, start, width, rows)
      for (let row = 0; row < rows; row++) {
        for (let x = 0; x < width; x++) {
          if (data[(row * width + x) * 4 + 3] === 0) {
            hasTransparentPixel = true
          } else {
            left = Math.min(left, x)
            top = Math.min(top, start + row)
            right = Math.max(right, x)
            bottom = Math.max(bottom, start + row)
          }
        }
      }
    }
    if (!hasTransparentPixel || right < 0) {
      throw new Error(
        'The take needs visible jewelry and transparent pixels. Render a still with a Transparent backdrop.',
      )
    }
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export async function loadPhotoCutout(assetId: string, signal: AbortSignal): Promise<Cutout> {
  const image = await decodeImage(await fetchTakePng(assetId, signal), true)
  try {
    signal.throwIfAborted()
    return { image, bounds: cropTransparentImage(image) }
  } catch (error) {
    image.close()
    throw error
  }
}

export function drawPhotoLayout(
  canvas: HTMLCanvasElement,
  photo: ImageBitmap,
  cutout: Cutout | undefined,
  placement: Placement,
  scale = 1,
) {
  const width = Math.max(1, Math.round(photo.width * scale))
  const height = Math.max(1, Math.round(photo.height * scale))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not draw the photo layout on this device.')
  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(photo, 0, 0, width, height)
  if (!cutout) return
  const { bounds, image } = cutout
  const ratio =
    (Math.min(photo.width, photo.height) * scale * placement.size) /
    (100 * Math.max(bounds.width, bounds.height))
  const w = bounds.width * ratio
  const h = bounds.height * ratio
  ctx.save()
  ctx.translate((width * placement.x) / 100, (height * placement.y) / 100)
  ctx.rotate((placement.angle * Math.PI) / 180)
  ctx.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, -w / 2, -h / 2, w, h)
  ctx.restore()
}

export async function photoLayoutPng(
  photo: ImageBitmap,
  cutout: Cutout,
  placement: Placement,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  try {
    drawPhotoLayout(canvas, photo, cutout, placement)
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error('Could not make a full-size PNG.'))),
        'image/png',
      )
    })
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
