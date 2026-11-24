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
