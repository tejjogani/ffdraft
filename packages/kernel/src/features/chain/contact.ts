/**
 * How two links sit together, measured on their centrelines: clearance between the wires and
 * whether the loops are actually threaded through each other. Every link pitch is solved with
 * these, so links interlock without intersecting for any width / wire combination.
 */
import type { Mat4 } from '../../geometry/vec'

/** A closed centreline (rows of xyz) and the radius of the wire around it. */
export interface WireLoop {
  points: Float64Array
  radius: number
}

export function moveLoop(loop: WireLoop, m: Mat4): WireLoop {
  const src = loop.points
  const out = new Float64Array(src.length)
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i]!
    const y = src[i + 1]!
    const z = src[i + 2]!
    out[i] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
    out[i + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
    out[i + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
  }
  return { points: out, radius: loop.radius }
}

/** Squared distance between segments p0p1 and q0q1 (Ericson, Real-Time Collision Detection §5.1.9). */
function segmentDistance2(
  a: Float64Array,
  i: number,
  j: number,
  b: Float64Array,
  k: number,
  l: number,
): number {
  const d1x = a[j]! - a[i]!
  const d1y = a[j + 1]! - a[i + 1]!
  const d1z = a[j + 2]! - a[i + 2]!
  const d2x = b[l]! - b[k]!
  const d2y = b[l + 1]! - b[k + 1]!
  const d2z = b[l + 2]! - b[k + 2]!
  const rx = a[i]! - b[k]!
  const ry = a[i + 1]! - b[k + 1]!
  const rz = a[i + 2]! - b[k + 2]!
  const aa = d1x * d1x + d1y * d1y + d1z * d1z
  const ee = d2x * d2x + d2y * d2y + d2z * d2z
  const f = d2x * rx + d2y * ry + d2z * rz
  const c = d1x * rx + d1y * ry + d1z * rz
  const bb = d1x * d2x + d1y * d2y + d1z * d2z
  const denom = aa * ee - bb * bb
  let s = denom > 1e-12 ? Math.min(1, Math.max(0, (bb * f - c * ee) / denom)) : 0
  let t = (bb * s + f) / ee
  if (t < 0) {
    t = 0
    s = Math.min(1, Math.max(0, -c / aa))
  } else if (t > 1) {
    t = 1
    s = Math.min(1, Math.max(0, (bb - c) / aa))
  }
  const dx = rx + d1x * s - d2x * t
  const dy = ry + d1y * s - d2y * t
  const dz = rz + d1z * s - d2z * t
  return dx * dx + dy * dy + dz * dz
}

/** Smallest gap between the wire surfaces of two closed loops (negative when they intersect). */
export function clearance(a: WireLoop, b: WireLoop): number {
  const pa = a.points
  const pb = b.points
  const na = pa.length / 3
  const nb = pb.length / 3
  let best = Infinity
  for (let i = 0; i < na; i++) {
    const i1 = ((i + 1) % na) * 3
    for (let k = 0; k < nb; k++) {
      const d = segmentDistance2(pa, i * 3, i1, pb, k * 3, ((k + 1) % nb) * 3)
      if (d < best) best = d
    }
  }
  return Math.sqrt(best) - a.radius - b.radius
}

/**
 * Gauss linking number of two closed polylines, summed exactly per segment pair
 * (Klenin & Langowski, Biopolymers 54, 2000). ±1 when the loops are threaded once.
 */
export function linking(a: WireLoop, b: WireLoop): number {
  const pa = a.points
  const pb = b.points
  const na = pa.length / 3
  const nb = pb.length / 3
  const v = new Float64Array(12)
  const sub = (o: number, p: Float64Array, i: number, q: Float64Array, j: number) => {
    v[o] = q[j]! - p[i]!
    v[o + 1] = q[j + 1]! - p[i + 1]!
    v[o + 2] = q[j + 2]! - p[i + 2]!
  }
  const unitCross = (o1: number, o2: number): [number, number, number] => {
    const x = v[o1 + 1]! * v[o2 + 2]! - v[o1 + 2]! * v[o2 + 1]!
    const y = v[o1 + 2]! * v[o2]! - v[o1]! * v[o2 + 2]!
    const z = v[o1]! * v[o2 + 1]! - v[o1 + 1]! * v[o2]!
    const l = Math.hypot(x, y, z) || 1
    return [x / l, y / l, z / l]
  }
  const asinDot = (p: number[], q: number[]) =>
    Math.asin(Math.max(-1, Math.min(1, p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!)))
  let total = 0
  for (let i = 0; i < na; i++) {
    const i0 = i * 3
    const i1 = ((i + 1) % na) * 3
    for (let k = 0; k < nb; k++) {
      const k0 = k * 3
      const k1 = ((k + 1) % nb) * 3
      sub(0, pa, i0, pb, k0) // r13
      sub(3, pa, i0, pb, k1) // r14
      sub(6, pa, i1, pb, k0) // r23
      sub(9, pa, i1, pb, k1) // r24
      const n1 = unitCross(0, 3)
      const n2 = unitCross(3, 9)
      const n3 = unitCross(9, 6)
      const n4 = unitCross(6, 0)
      const omega = asinDot(n1, n2) + asinDot(n2, n3) + asinDot(n3, n4) + asinDot(n4, n1)
      // sign of (r34 × r12) · r13
      const r12 = [pa[i1]! - pa[i0]!, pa[i1 + 1]! - pa[i0 + 1]!, pa[i1 + 2]! - pa[i0 + 2]!]
      const r34 = [pb[k1]! - pb[k0]!, pb[k1 + 1]! - pb[k0 + 1]!, pb[k1 + 2]! - pb[k0 + 2]!]
      const cx = r34[1]! * r12[2]! - r34[2]! * r12[1]!
      const cy = r34[2]! * r12[0]! - r34[0]! * r12[2]!
      const cz = r34[0]! * r12[1]! - r34[1]! * r12[0]!
      const sign = Math.sign(cx * v[0]! + cy * v[1]! + cz * v[2]!)
      total += omega * sign
    }
  }
  return total / (4 * Math.PI)
}

/** True when the loops are threaded through each other once and do not touch. */
export const interlocked = (a: WireLoop, b: WireLoop, gap: number): boolean =>
  clearance(a, b) >= gap && Math.abs(Math.abs(linking(a, b)) - 1) < 0.25

/** Thrown when two links cannot be threaded together without touching. */
export class InterlockError extends Error {
  constructor() {
    super('These links cannot interlock; use a thinner wire or wider links')
    this.name = 'InterlockError'
  }
}

/** Pitches at which two links stay threaded and clear: nested tight (min) to pulled taut (max). */
export interface PitchRange {
  min: number
  max: number
}

/**
 * The interval of pitches at which `pair(p)` keeps two loops interlocked with at least `gap`
 * between them. Scans down from `start` (links apart) to the first interlocked pitch, then
 * refines both ends of that interval by bisection.
 */
export function pitchRange(
  pair: (pitch: number) => [WireLoop, WireLoop],
  start: number,
  step: number,
  gap: number,
): PitchRange {
  const ok = (p: number) => {
    const [a, b] = pair(p)
    return interlocked(a, b, gap)
  }
  const refine = (inside: number, outside: number) => {
    let a = inside
    let b = outside
    for (let i = 0; i < 12; i++) {
      const mid = (a + b) / 2
      if (ok(mid)) a = mid
      else b = mid
    }
    return a
  }
  let p = start
  while (p > step && !ok(p)) p -= step
  if (p <= step) throw new InterlockError()
  const max = refine(p, p + step)
  let q = p
  while (q > step && ok(q - step)) q -= step
  return { min: refine(q, q - step), max }
}
