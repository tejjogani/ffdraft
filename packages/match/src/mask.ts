/**
 * Binary masks on typed arrays: one byte per pixel, row-major, nonzero = set. Pixel (x, y) has its
 * centre at (x + 0.5, y + 0.5), the convention every function here and in the scores uses.
 */
import type { Moments, Size } from './types'

/** Area as a fraction of the image; centroid as fractions of the width and height. */
export function moments(mask: Uint8Array, size: Size): Moments {
  const { width: w, height: h } = size
  let a = 0
  let sx = 0
  let sy = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        a++
        sx += x + 0.5
        sy += y + 0.5
      }
  if (!a) return { area: 0, cx: 0.5, cy: 0.5 }
  return { area: a / (w * h), cx: sx / a / w, cy: sy / a / h }
}

/** Set pixels with an unset 4-neighbour; outside the image counts as unset. `into` is reused when given. */
export function edges(mask: Uint8Array, size: Size, into?: Uint8Array): Uint8Array {
  const { width: w, height: h } = size
  const out = into ? into.fill(0) : new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (!mask[k]) continue
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) out[k] = 1
      else if (!mask[k - 1] || !mask[k + 1] || !mask[k - w] || !mask[k + w]) out[k] = 1
    }
  return out
}

const BIG = 1e9

/**
 * Distance from every pixel to the nearest set pixel, in pixels: a two-pass chamfer with weights
 * 1 and √2 (exact along rows, columns and diagonals; at most about 8 % long elsewhere). An empty
 * mask gives 1e9 everywhere.
 */
export function distanceTransform(mask: Uint8Array, size: Size, into?: Float32Array): Float32Array {
  const { width: w, height: h } = size
  const d = into ?? new Float32Array(w * h)
  const D = Math.SQRT2
  for (let k = 0; k < w * h; k++) d[k] = mask[k] ? 0 : BIG
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      let v = d[k]!
      if (x > 0) v = Math.min(v, d[k - 1]! + 1)
      if (y > 0) {
        v = Math.min(v, d[k - w]! + 1)
        if (x > 0) v = Math.min(v, d[k - w - 1]! + D)
        if (x < w - 1) v = Math.min(v, d[k - w + 1]! + D)
      }
      d[k] = v
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const k = y * w + x
      let v = d[k]!
      if (x < w - 1) v = Math.min(v, d[k + 1]! + 1)
      if (y < h - 1) {
        v = Math.min(v, d[k + w]! + 1)
        if (x < w - 1) v = Math.min(v, d[k + w + 1]! + D)
        if (x > 0) v = Math.min(v, d[k + w - 1]! + D)
      }
      d[k] = v
    }
  return d
}

/** Nearest-neighbour resampling at pixel centres. */
export function resize(mask: Uint8Array, from: Size, to: Size): Uint8Array {
  const out = new Uint8Array(to.width * to.height)
  const sx = from.width / to.width
  const sy = from.height / to.height
  for (let y = 0; y < to.height; y++) {
    const yy = Math.min(from.height - 1, Math.floor((y + 0.5) * sy))
    for (let x = 0; x < to.width; x++) {
      const xx = Math.min(from.width - 1, Math.floor((x + 0.5) * sx))
      out[y * to.width + x] = mask[yy * from.width + xx]!
    }
  }
  return out
}

/** 8-connected components: area in pixels, centroid in pixels, and equivalent-circle diameter. */
export function components(
  mask: Uint8Array,
  size: Size,
): { area: number; cx: number; cy: number; d: number }[] {
  const { width: w, height: h } = size
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  const out: { area: number; cx: number; cy: number; d: number }[] = []
  for (let k0 = 0; k0 < w * h; k0++) {
    if (!mask[k0] || seen[k0]) continue
    let top = 0
    stack[top++] = k0
    seen[k0] = 1
    let a = 0
    let sx = 0
    let sy = 0
    while (top) {
      const k = stack[--top]!
      const x = k % w
      const y = (k - x) / w
      a++
      sx += x + 0.5
      sy += y + 0.5
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const j = yy * w + xx
          if (mask[j] && !seen[j]) {
            seen[j] = 1
            stack[top++] = j
          }
        }
      }
    }
    out.push({ area: a, cx: sx / a, cy: sy / a, d: 2 * Math.sqrt(a / Math.PI) })
  }
  return out
}

/** Grow by `px` pixels (chamfer distance ≤ px). */
export function dilate(mask: Uint8Array, size: Size, px: number): Uint8Array {
  const d = distanceTransform(mask, size)
  const out = new Uint8Array(mask.length)
  for (let k = 0; k < mask.length; k++) out[k] = d[k]! <= px + 1e-6 ? 1 : 0
  return out
}

/** Shrink by `px` pixels: the complement of dilating the complement. */
export function erode(mask: Uint8Array, size: Size, px: number): Uint8Array {
  const inv = new Uint8Array(mask.length)
  for (let k = 0; k < mask.length; k++) inv[k] = mask[k] ? 0 : 1
  const grown = dilate(inv, size, px)
  for (let k = 0; k < mask.length; k++) inv[k] = grown[k] ? 0 : 1
  return inv
}
