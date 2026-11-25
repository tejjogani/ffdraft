/**
 * A subject matte from a product photo on a plain background, with no model: the background
 * colour is read from the border, pixels close to it and connected to the border are background
 * (a flood fill), and large enclosed regions of the same colour (the hole of a ring seen from the
 * top) are background too. It is the classical stand-in for a segmenter (plan §10), good enough
 * for a jeweller's white-sweep or studio photo and honest about anything else: `plain` is false,
 * with the reason, whenever the border is not one even colour.
 *
 * Transparent pixels (a cut-out PNG) are background whatever their colour.
 */
import type { Size } from './types'

export interface MatteResult {
  /** 1 = the piece, 0 = background; row-major, `size.width × size.height`. */
  matte: Uint8Array
  /** Whether the photo has a plain background a matte can be trusted on. */
  plain: boolean
  /** Why `plain` is what it is, in plain words. */
  reason: string
  /** The background colour read from the border. */
  background: [number, number, number]
  /** Fraction of the frame the subject covers. */
  coverage: number
}

/** Share of border pixels that must match the background colour for it to count as plain. */
export const PLAIN_BORDER = 0.85
/** Colour distance (0–255, largest channel) under which a border pixel matches the background. */
const BORDER_TOLERANCE = 28
/** Enclosed background regions at least this share of the frame are holes, not highlights. */
const HOLE_MIN = 0.002
/** Subject specks under this share of the frame are dust or noise. */
const SPECK_MAX = 0.0005

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

/** Otsu's threshold over a 0–255 histogram. */
function otsu(hist: Uint32Array, total: number): number {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]!
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 0
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]!
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

/** 4-connected regions of `mask`, each as its pixel indices. */
function regions(mask: Uint8Array, size: Size): Int32Array[] {
  const { width: w, height: h } = size
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  const out: Int32Array[] = []
  for (let k0 = 0; k0 < w * h; k0++) {
    if (!mask[k0] || seen[k0]) continue
    let top = 0
    stack[top++] = k0
    seen[k0] = 1
    const pixels: number[] = []
    while (top) {
      const k = stack[--top]!
      pixels.push(k)
      const x = k % w
      const visit = (j: number) => {
        if (mask[j] && !seen[j]) {
          seen[j] = 1
          stack[top++] = j
        }
      }
      if (x > 0) visit(k - 1)
      if (x < w - 1) visit(k + 1)
      if (k >= w) visit(k - w)
      if (k < w * (h - 1)) visit(k + w)
    }
    out.push(Int32Array.from(pixels))
  }
  return out
}

/** The matte of `rgba` (4 bytes per pixel, row-major). */
export function subjectMatte(rgba: Uint8Array | Uint8ClampedArray, size: Size): MatteResult {
  const { width: w, height: h } = size
  const n = w * h
  if (rgba.length < n * 4)
    throw new Error('subjectMatte: the pixel buffer is smaller than its size')

  // The border band: one percent of the short side, at least one pixel.
  const band = Math.max(1, Math.round(0.01 * Math.min(w, h)))
  const isBorder = (x: number, y: number) => x < band || y < band || x >= w - band || y >= h - band
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!isBorder(x, y)) continue
      const k = (y * w + x) * 4
      if (rgba[k + 3]! < 128) continue
      rs.push(rgba[k]!)
      gs.push(rgba[k + 1]!)
      bs.push(rgba[k + 2]!)
    }
  const background: [number, number, number] = [median(rs), median(gs), median(bs)]

  // Distance of every pixel to the background colour; transparent pixels are background.
  const dist = new Uint8Array(n)
  const hist = new Uint32Array(256)
  for (let k = 0; k < n; k++) {
    const p = k * 4
    const d =
      rgba[p + 3]! < 128
        ? 0
        : Math.max(
            Math.abs(rgba[p]! - background[0]),
            Math.abs(rgba[p + 1]! - background[1]),
            Math.abs(rgba[p + 2]! - background[2]),
          )
    dist[k] = d
    hist[d] = hist[d]! + 1
  }

  let borderTotal = 0
  let borderMatch = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (isBorder(x, y)) {
        borderTotal++
        if (dist[y * w + x]! <= BORDER_TOLERANCE) borderMatch++
      }
  const evenness = borderMatch / Math.max(1, borderTotal)

  // Otsu splits background from subject; kept within sane bounds so a faint subject (white gold
  // on white) is not swallowed and a noisy sweep is not split into a subject.
  const threshold = Math.min(60, Math.max(14, otsu(hist, n)))
  const near = new Uint8Array(n)
  for (let k = 0; k < n; k++) near[k] = dist[k]! <= threshold ? 1 : 0

  // Background = near pixels connected to the border.
  const bg = new Uint8Array(n)
  const stack = new Int32Array(n)
  let top = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && near[k] && !bg[k]) {
        bg[k] = 1
        stack[top++] = k
      }
    }
  const flood = (j: number) => {
    if (near[j] && !bg[j]) {
      bg[j] = 1
      stack[top++] = j
    }
  }
  while (top) {
    const k = stack[--top]!
    const x = k % w
    if (x > 0) flood(k - 1)
    if (x < w - 1) flood(k + 1)
    if (k >= w) flood(k - w)
    if (k < n - w) flood(k + w)
  }

  // Enclosed near-background regions: a large one is a hole (the inside of a ring); a small one
  // is a highlight on metal and stays part of the piece. Holes must be closer to the background
  // than the split itself, so a broad pale face of white gold is not punched out.
  const enclosed = new Uint8Array(n)
  for (let k = 0; k < n; k++) enclosed[k] = !bg[k] && dist[k]! <= threshold * 0.6 ? 1 : 0
  for (const region of regions(enclosed, size))
    if (region.length >= HOLE_MIN * n) for (const k of region) bg[k] = 1

  const matte = new Uint8Array(n)
  for (let k = 0; k < n; k++) matte[k] = bg[k] ? 0 : 1
  // Dust and sensor noise.
  for (const region of regions(matte, size))
    if (region.length < SPECK_MAX * n) for (const k of region) matte[k] = 0

  let area = 0
  for (let k = 0; k < n; k++) area += matte[k]!
  const coverage = area / n
  const pct = (x: number) => `${Math.round(x * 100)} %`
  let plain = true
  let reason = `Plain background (${pct(evenness)} of the border is one colour); the piece covers ${pct(coverage)} of the photo.`
  if (evenness < PLAIN_BORDER) {
    plain = false
    reason = `The background is not plain: only ${pct(evenness)} of the photo’s border is one even colour, so the piece cannot be cut out reliably.`
  } else if (coverage < 0.01) {
    plain = false
    reason = 'No piece stands out from the background (it may be too small or too pale).'
  } else if (coverage > 0.9) {
    plain = false
    reason = 'The piece fills almost the whole photo, so its outline is not in the picture.'
  }
  return { matte, plain, reason, background, coverage }
}
