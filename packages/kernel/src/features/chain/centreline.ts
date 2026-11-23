/**
 * Wire centrelines for chain links and findings: closed or open curves sampled evenly by arc
 * length, with the direction the wire's section faces at each sample, and the wire swept
 * along them.
 */
import type { Solid } from '../../core'
import type { Loop } from '../../geometry/loop'
import { placeLoop, sweepSolid } from '../../geometry/sweep'
import { cross, dot, normalize, scale, sub, type Vec3 } from '../../geometry/vec'

/** A centreline with a section orientation per sample (rows of xyz). */
export interface Centreline {
  points: Float64Array
  /** Reference direction for the section's second axis; made perpendicular to the tangent. */
  ups: Float64Array
  closed: boolean
}

const at = (a: Float64Array, i: number): Vec3 => [a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!]

/**
 * Samples `curve(t)` for t in [0, 1) (closed) or [0, 1] (open) at `count` points equally
 * spaced in arc length, with `up(t)` evaluated at the same parameters.
 */
export function sampleCurve(
  curve: (t: number) => Vec3,
  up: (t: number) => Vec3,
  count: number,
  closed: boolean,
): Centreline {
  const dense = count * 16
  const ts: number[] = []
  const lengths = [0]
  let previous = curve(0)
  for (let i = 1; i <= dense; i++) {
    const t = i / dense
    const p = curve(t)
    lengths.push(
      lengths[i - 1]! + Math.hypot(p[0] - previous[0], p[1] - previous[1], p[2] - previous[2]),
    )
    previous = p
  }
  const total = lengths[dense]!
  const steps = closed ? count : count - 1
  let k = 0
  for (let i = 0; i < count; i++) {
    const target = (i / steps) * total
    while (k < dense - 1 && lengths[k + 1]! < target) k++
    const span = lengths[k + 1]! - lengths[k]!
    ts.push((k + (span > 0 ? (target - lengths[k]!) / span : 0)) / dense)
  }
  const points = new Float64Array(count * 3)
  const ups = new Float64Array(count * 3)
  ts.forEach((t, i) => {
    points.set(curve(t), i * 3)
    ups.set(up(t), i * 3)
  })
  return { points, ups, closed }
}

/** Samples around a section of half-size `r` so the facets stay within `chord` of the surface. */
export function segmentsFor(radius: number, chord: number, min: number, max: number): number {
  const ratio = Math.min(1, chord / Math.max(radius, 1e-6))
  const step = 2 * Math.acos(1 - ratio)
  return Math.max(min, Math.min(max, Math.ceil((2 * Math.PI) / step)))
}

/**
 * The wire swept along a centreline: exact B-rep on demand and an analytic mesh, from the core's
 * NURBS sweep (geometry/sweep.ts). The loop's x follows the side (up × travel), y follows `up`.
 * `loop` may vary along the wire (t from 0 to 1); every station must have the same segments.
 */
export function sweepAlong(line: Centreline, loop: Loop | ((t: number) => Loop)): Solid {
  const { points, ups, closed } = line
  const n = points.length / 3
  const span = closed ? n : n - 1
  const profile = typeof loop === 'function' ? loop : () => loop
  const sections = Array.from({ length: n }, (_, i) => {
    const prev = closed ? (i + n - 1) % n : Math.max(0, i - 1)
    const next = closed ? (i + 1) % n : Math.min(n - 1, i + 1)
    const z = normalize(sub(at(points, next), at(points, prev)))
    const up = at(ups, i)
    const y = normalize(sub(up, scale(z, dot(up, z))))
    return placeLoop({ origin: at(points, i), x: cross(y, z), y, z }, profile(i / span))
  })
  return sweepSolid({ sections, closed })
}
