/**
 * Stones as points: where the model's stones land in an image, how they pair with the marks a
 * segmenter found, and what a field of marks says about a pavé layout. Counts are reported and
 * compared, never fitted and never stored (plan §13.5): the kernel counts.
 */

import type { Evaluation } from '@pave/kernel/types'
import { MELEE_SIZES_MM, snapToMelee } from '@pave/schema'
import { project } from './camera'
import type { Camera, Size, StoneMark } from './types'

export function projectStones(
  e: Evaluation,
  c: Camera,
  size: Size,
  o: { nodeIds?: string[] } = {},
): (StoneMark & { id: string })[] {
  const n = Math.max(size.width, size.height)
  const out: (StoneMark & { id: string })[] = []
  for (const s of e.stones) {
    if (o.nodeIds && !o.nodeIds.includes(s.nodeId)) continue
    const m = s.matrix
    const p = project(c, size, [m[12]!, m[13]!, m[14]!])
    if (p.depth <= 0) continue
    out.push({ id: s.id, x: p.x, y: p.y, d: (s.dims.width * n * c.distance) / (c.span * p.depth) })
  }
  return out
}

/**
 * Greedy nearest-first pairing within `maxPx` (deterministic: ties go to the lower indices).
 * `missing` are marks of `a` with no partner in `b`; `extra` are marks of `b` with none in `a`.
 */
export function matchStones(
  a: StoneMark[],
  b: StoneMark[],
  maxPx: number,
): { pairs: [number, number][]; missing: number[]; extra: number[]; meanPx: number } {
  const cand: { i: number; j: number; d: number }[] = []
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      const d = Math.hypot(a[i]!.x - b[j]!.x, a[i]!.y - b[j]!.y)
      if (d <= maxPx) cand.push({ i, j, d })
    }
  cand.sort((p, q) => p.d - q.d || p.i - q.i || p.j - q.j)
  const usedA = new Uint8Array(a.length)
  const usedB = new Uint8Array(b.length)
  const pairs: [number, number][] = []
  let sum = 0
  for (const c of cand) {
    if (usedA[c.i] || usedB[c.j]) continue
    usedA[c.i] = 1
    usedB[c.j] = 1
    pairs.push([c.i, c.j])
    sum += c.d
  }
  const missing: number[] = []
  const extra: number[] = []
  for (let i = 0; i < a.length; i++) if (!usedA[i]) missing.push(i)
  for (let j = 0; j < b.length; j++) if (!usedB[j]) extra.push(j)
  return { pairs, missing, extra, meanPx: pairs.length ? sum / pairs.length : 0 }
}

const quantile = (xs: number[], q: number) => {
  const s = xs.slice().sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!
}

/** Area fraction of a hexagonal field of circles of diameter `s` at pitch `s + gap`. */
export function packingDensity(s: number, gap: number): number {
  return (Math.PI * s * s) / (2 * Math.sqrt(3) * (s + gap) ** 2)
}

/**
 * What a field of stone marks says about a `pave` node: size range (10th and 90th percentile,
 * snapped to stock melee), gap (median nearest-neighbour distance less the median diameter) and
 * coverage (stone area over body area, divided by the packing density of that size and gap).
 */
export function paveStats(
  marks: StoneMark[],
  mmPerPx: number,
  bodyAreaPx: number,
): { sizeMin: number; sizeMax: number; gap: number; coverage: number } {
  if (!marks.length)
    return { sizeMin: MELEE_SIZES_MM[0], sizeMax: MELEE_SIZES_MM[0], gap: 0, coverage: 0 }
  const dMm = marks.map((m) => m.d * mmPerPx)
  const nn = marks.map((m, i) => {
    let best = Infinity
    for (let j = 0; j < marks.length; j++)
      if (j !== i) best = Math.min(best, Math.hypot(m.x - marks[j]!.x, m.y - marks[j]!.y))
    return best * mmPerPx
  })
  const medD = quantile(dMm, 0.5)
  const gap = marks.length > 1 ? Math.max(0, quantile(nn, 0.5) - medD) : 0
  const stoneArea = dMm.reduce((s, d) => s + (Math.PI * d * d) / 4, 0)
  const bodyArea = bodyAreaPx * mmPerPx * mmPerPx
  const coverage = bodyArea > 0 ? stoneArea / bodyArea / packingDensity(medD, gap) : 0
  return {
    sizeMin: snapToMelee(quantile(dMm, 0.1)),
    sizeMax: snapToMelee(quantile(dMm, 0.9)),
    gap: Math.round(gap * 1000) / 1000,
    coverage: Math.min(1, Math.max(0, coverage)),
  }
}

/** Stones a hexagonal field would hold: one per cell of pitch (mean size + gap). Unverified against the kernel's packing. */
export function expectedCount(i: {
  areaMm2: number
  sizeMin: number
  sizeMax: number
  gap: number
  coverage: number
}): number {
  const pitch = (i.sizeMin + i.sizeMax) / 2 + i.gap
  return Math.round((i.coverage * i.areaMm2) / ((Math.sqrt(3) / 2) * pitch * pitch))
}

/** Stones along an open arc: n stones and n − 1 gaps must fit. */
export function rowCount(arcMm: number, stoneMm: number, gapMm: number): number {
  return Math.max(0, Math.floor((arcMm + gapMm) / (stoneMm + gapMm)))
}
