/**
 * PNG decoding in plain TypeScript (zlib via fflate), so height maps load the same way in Node
 * and in a Worker — no DOM, no canvas. Supports every colour type and bit depth of the PNG 1.2
 * spec, palettes with transparency, and Adam7 interlacing.
 */
import { unzlibSync } from 'fflate'
import type { Raster } from './raster'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export const isPng = (bytes: Uint8Array): boolean => SIGNATURE.every((b, i) => bytes[i] === b)

/** Channels per colour type: grey, –, RGB, palette, grey+alpha, –, RGBA. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** Adam7 passes: x0, y0, dx, dy. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const

export function decodePng(bytes: Uint8Array): Raster {
  if (!isPng(bytes)) throw new Error('Not a PNG file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let depth = 8
  let type = 0
  let interlace = 0
  let palette: Uint8Array | null = null
  let transparency: Uint8Array | null = null
  const data: Uint8Array[] = []
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at)
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (name === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      depth = body[8]!
      type = body[9]!
      interlace = body[12]!
    } else if (name === 'PLTE') palette = body
    else if (name === 'tRNS') transparency = body
    else if (name === 'IDAT') data.push(body)
    else if (name === 'IEND') break
    at += 12 + length
  }
  const channels = CHANNELS[type]
  if (!channels || width === 0 || height === 0)
    throw new Error('The PNG file has an unsupported or missing header')
  if (width * height > 64e6) throw new Error('The PNG image is too large to use as a height map')
  const joined = new Uint8Array(data.reduce((n, d) => n + d.length, 0))
  let offset = 0
  for (const d of data) {
    joined.set(d, offset)
    offset += d.length
  }
  let raw: Uint8Array
  try {
    raw = unzlibSync(joined)
  } catch {
    throw new Error('The PNG image data is corrupt')
  }

  const out: Raster = { width, height, rgba: new Float32Array(width * height * 4) }
  const bitsPerPixel = channels * depth
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3)
  const max = (1 << depth) - 1
  let cursor = 0
  const passes = interlace ? ADAM7 : ([[0, 0, 1, 1]] as const)
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx)
    const ph = Math.ceil((height - y0) / dy)
    if (pw <= 0 || ph <= 0) continue
    const stride = Math.ceil((pw * bitsPerPixel) / 8)
    let previous = new Uint8Array(stride)
    for (let row = 0; row < ph; row++) {
      const filter = raw[cursor++]
      const line = raw.slice(cursor, cursor + stride)
      cursor += stride
      if (line.length < stride) throw new Error('The PNG image data ends early')
      unfilter(filter ?? 0, line, previous, bytesPerPixel)
      for (let col = 0; col < pw; col++) {
        const sample = (c: number): number => {
          if (depth === 16)
            return (
              ((line[(col * channels + c) * 2]! << 8) | line[(col * channels + c) * 2 + 1]!) / 65535
            )
          if (depth === 8) return line[col * channels + c]! / 255
          const bit = (col * channels + c) * depth
          return ((line[bit >> 3]! >> (8 - depth - (bit & 7))) & max) / max
        }
        const px = ((y0 + row * dy) * width + x0 + col * dx) * 4
        writePixel(out.rgba, px, type, sample, depth, max, palette, transparency)
      }
      previous = line
    }
  }
  return out
}

function writePixel(
  rgba: Float32Array,
  px: number,
  type: number,
  sample: (c: number) => number,
  depth: number,
  max: number,
  palette: Uint8Array | null,
  transparency: Uint8Array | null,
): void {
  let r: number
  let g: number
  let b: number
  let a = 1
  if (type === 3) {
    const index = Math.round(sample(0) * max)
    if (!palette || index * 3 + 2 >= palette.length)
      throw new Error('The PNG palette is missing an entry')
    r = palette[index * 3]! / 255
    g = palette[index * 3 + 1]! / 255
    b = palette[index * 3 + 2]! / 255
    if (transparency && index < transparency.length) a = transparency[index]! / 255
  } else if (type === 0 || type === 4) {
    r = g = b = sample(0)
    if (type === 4) a = sample(1)
    else if (transparency && transparency.length >= 2) {
      const key = ((transparency[0]! << 8) | transparency[1]!) / (depth === 16 ? 65535 : max)
      if (Math.abs(r - key) < 1e-6) a = 0
    }
  } else {
    r = sample(0)
    g = sample(1)
    b = sample(2)
    if (type === 6) a = sample(3)
  }
  rgba[px] = r
  rgba[px + 1] = g
  rgba[px + 2] = b
  rgba[px + 3] = a
}

/** Reverses a scanline filter in place (PNG 1.2 §9). */
function unfilter(filter: number, line: Uint8Array, prev: Uint8Array, bpp: number): void {
  for (let i = 0; i < line.length; i++) {
    const left = i >= bpp ? line[i - bpp]! : 0
    const up = prev[i]!
    const corner = i >= bpp ? prev[i - bpp]! : 0
    let add = 0
    if (filter === 1) add = left
    else if (filter === 2) add = up
    else if (filter === 3) add = (left + up) >> 1
    else if (filter === 4) {
      const p = left + up - corner
      const pa = Math.abs(p - left)
      const pb = Math.abs(p - up)
      const pc = Math.abs(p - corner)
      add = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner
    } else if (filter !== 0) throw new Error(`The PNG image uses unknown filter ${filter}`)
    line[i] = (line[i]! + add) & 255
  }
}
