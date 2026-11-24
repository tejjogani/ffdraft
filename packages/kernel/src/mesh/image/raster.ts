/**
 * Decoded images for height maps: format sniffing, luminance, smoothing and sampling. Works on
 * plain arrays, so the same code runs in Node and in the kernel Worker.
 */
import { decode as decodeJpegBytes } from 'jpeg-js'
import { decodePng, isPng } from './png'

/** Straight (non-premultiplied) RGBA, 0–1, row-major from the top-left. */
export interface Raster {
  width: number
  height: number
  rgba: Float32Array
}

const isJpeg = (bytes: Uint8Array): boolean =>
  bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

function decodeJpeg(bytes: Uint8Array): Raster {
  let image: { width: number; height: number; data: Uint8Array }
  try {
    image = decodeJpegBytes(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 })
  } catch (error) {
    throw new Error(
      `The JPEG image could not be read (${error instanceof Error ? error.message : 'corrupt data'})`,
    )
  }
  const rgba = new Float32Array(image.width * image.height * 4)
  for (let i = 0; i < rgba.length; i++) rgba[i] = image.data[i]! / 255
  return { width: image.width, height: image.height, rgba }
}

/** Decodes a PNG or JPEG, whichever the bytes are. */
export function decodeImage(bytes: Uint8Array): Raster {
  if (isPng(bytes)) return decodePng(bytes)
  if (isJpeg(bytes)) return decodeJpeg(bytes)
  throw new Error('The height map must be a PNG or JPEG image')
}

/**
 * Height per pixel, 0–1: luminance (Rec. 709 weights), optionally inverted, multiplied by alpha
 * so transparent background stays at the base.
 */
export function luminanceHeights(image: Raster, invert: boolean): Float32Array {
  const out = new Float32Array(image.width * image.height)
  for (let i = 0; i < out.length; i++) {
    const p = image.rgba
    const l = 0.2126 * p[i * 4]! + 0.7152 * p[i * 4 + 1]! + 0.0722 * p[i * 4 + 2]!
    out[i] = (invert ? 1 - l : l) * p[i * 4 + 3]!
  }
  return out
}

/**
 * Samples a w×h scalar image (row-major from the top-left) at continuous pixel coordinates
 * (u, v) — pixel k spans [k, k + 1) — over a square footprint `size` pixels wide: bilinear where
 * the footprint is smaller than a pixel (the image is coarser than the grid sampling it), the
 * mean of the covered pixels where it is larger. A summed-area table keeps both O(1).
 */
export class ImageSampler {
  private readonly sums: Float64Array

  constructor(
    private readonly values: Float32Array,
    private readonly w: number,
    private readonly h: number,
  ) {
    this.sums = new Float64Array((w + 1) * (h + 1))
    for (let y = 0; y < h; y++) {
      let row = 0
      for (let x = 0; x < w; x++) {
        row += values[y * w + x]!
        this.sums[(y + 1) * (w + 1) + x + 1] = this.sums[y * (w + 1) + x + 1]! + row
      }
    }
  }

  sample(u: number, v: number, size: number): number {
    return size <= 1 ? this.bilinear(u - 0.5, v - 0.5) : this.mean(u, v, size / 2)
  }

  private bilinear(x: number, y: number): number {
    const { w, h, values } = this
    const fx = Math.min(Math.max(x, 0), w - 1)
    const fy = Math.min(Math.max(y, 0), h - 1)
    const i = Math.min(Math.floor(fx), Math.max(w - 2, 0))
    const j = Math.min(Math.floor(fy), Math.max(h - 2, 0))
    const i1 = Math.min(i + 1, w - 1)
    const j1 = Math.min(j + 1, h - 1)
    const tx = fx - i
    const ty = fy - j
    const top = values[j * w + i]! * (1 - tx) + values[j * w + i1]! * tx
    const bottom = values[j1 * w + i]! * (1 - tx) + values[j1 * w + i1]! * tx
    return top * (1 - ty) + bottom * ty
  }

  private mean(u: number, v: number, r: number): number {
    const { w, h } = this
    const x0 = Math.min(Math.max(Math.round(u - r), 0), w - 1)
    const y0 = Math.min(Math.max(Math.round(v - r), 0), h - 1)
    const x1 = Math.min(Math.max(Math.round(u + r), x0 + 1), w)
    const y1 = Math.min(Math.max(Math.round(v + r), y0 + 1), h)
    const s = this.sums
    const W = w + 1
    const total = s[y1 * W + x1]! - s[y0 * W + x1]! - s[y1 * W + x0]! + s[y0 * W + x0]!
    return total / ((x1 - x0) * (y1 - y0))
  }
}

/** Separable Gaussian blur of a w×h scalar field (edges clamp). */
export function blur(values: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return values
  const radius = Math.ceil(sigma * 3)
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) =>
    Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)),
  )
  const total = kernel.reduce((a, b) => a + b, 0)
  const pass = (src: Float32Array, horizontal: boolean): Float32Array => {
    const dst = new Float32Array(src.length)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sum = 0
        for (let k = -radius; k <= radius; k++) {
          const xi = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x
          const yi = horizontal ? y : Math.min(h - 1, Math.max(0, y + k))
          sum += src[yi * w + xi]! * kernel[k + radius]!
        }
        dst[y * w + x] = sum / total
      }
    return dst
  }
  return pass(pass(values, true), false)
}
