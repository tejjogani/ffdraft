/**
 * Corruption that stands in for a real segmenter on a real photo (plan §12): `noisy` moves the
 * outline by a pixel in blocks, blurs it, offsets the crop by up to 2 px, drops 10 % of the stone
 * marks and jitters the rest by 2 px; `hard` adds a 2 px erosion and holes of up to 2 % of the
 * area (its camera distance and anchor error are drawn in `synth`). How close this is to real
 * mask noise on polished metal is unverified. `misspec` keeps the masks clean: its difficulty is
 * in the truth (`synth`), which the recipe cannot draw exactly.
 */
import { dilate, erode } from '../mask'
import type { Size, StoneMark, TargetView } from '../types'

export type Level = 'clean' | 'noisy' | 'hard' | 'misspec'

const BLOCK = 16

/** Per 16 px block: keep, grow by 1 px or shrink by 1 px. */
function blockNoise(m: Uint8Array, size: Size, choice: Uint8Array): Uint8Array {
  const grown = dilate(m, size, 1)
  const shrunk = erode(m, size, 1)
  const bw = Math.ceil(size.width / BLOCK)
  const out = new Uint8Array(m.length)
  for (let y = 0; y < size.height; y++)
    for (let x = 0; x < size.width; x++) {
      const k = y * size.width + x
      const c = choice[Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK)]!
      out[k] = c === 1 ? grown[k]! : c === 2 ? shrunk[k]! : m[k]!
    }
  return out
}

/** A 3×3 box blur thresholded at one half: rounds corners and removes 1 px spurs. */
function blur(m: Uint8Array, size: Size): Uint8Array {
  const { width: w, height: h } = size
  const out = new Uint8Array(m.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) s += m[yy * w + xx]!
        }
      out[y * w + x] = s >= 5 ? 1 : 0
    }
  return out
}

function shift(m: Uint8Array, size: Size, dx: number, dy: number): Uint8Array {
  const { width: w, height: h } = size
  const out = new Uint8Array(m.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const xx = x - dx
      const yy = y - dy
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[y * w + x] = m[yy * w + xx]!
    }
  return out
}

function holes(m: Uint8Array, size: Size, rnd: () => number, fraction: number): Uint8Array {
  const out = m.slice()
  let area = 0
  for (const v of m) if (v) area++
  const budget = area * fraction
  let removed = 0
  for (let tries = 0; tries < 200 && removed < budget; tries++) {
    const cx = Math.floor(rnd() * size.width)
    const cy = Math.floor(rnd() * size.height)
    if (!m[cy * size.width + cx]) continue
    const r = 1 + rnd() * 3
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= size.width || y >= size.height) continue
        const k = y * size.width + x
        if (out[k] && Math.hypot(x - cx, y - cy) <= r && removed < budget) {
          out[k] = 0
          removed++
        }
      }
  }
  return out
}

export function degrade(v: TargetView, level: Level, rnd: () => number): TargetView {
  if (level === 'clean' || level === 'misspec') return v
  const size = { width: v.width, height: v.height }
  const bw = Math.ceil(v.width / BLOCK)
  const bh = Math.ceil(v.height / BLOCK)
  const choice = new Uint8Array(bw * bh)
  for (let i = 0; i < choice.length; i++) choice[i] = Math.floor(rnd() * 3)
  const dx = Math.round(rnd() * 4 - 2)
  const dy = Math.round(rnd() * 4 - 2)
  const pass = (m: Uint8Array) => {
    let x = shift(blur(blockNoise(m, size, choice), size), size, dx, dy)
    if (level === 'hard') x = erode(x, size, 2)
    return x
  }
  let matte = pass(v.matte)
  if (level === 'hard') matte = holes(matte, size, rnd, 0.02)
  const stones = v.stones ? pass(v.stones) : undefined
  let marks: StoneMark[] | undefined
  if (v.marks) {
    marks = []
    for (const m of v.marks) {
      if (rnd() < 0.1) continue
      marks.push({
        x: m.x + dx + (rnd() * 4 - 2),
        y: m.y + dy + (rnd() * 4 - 2),
        d: m.d * (0.9 + rnd() * 0.2),
      })
    }
  }
  return {
    ...v,
    matte,
    ...(stones ? { stones } : {}),
    ...(marks ? { marks } : {}),
    // Named regions get the same offset; their outlines stay as the segmenter drew them.
    ...(v.parts
      ? { parts: v.parts.map((p) => ({ ...p, mask: shift(p.mask, size, dx, dy) })) }
      : {}),
  }
}
