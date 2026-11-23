/**
 * Wire geometry for chain links and findings, in plain typed arrays: centrelines sampled by
 * arc length, and the watertight tube swept along them. Links are built once per chain and
 * instanced, so this runs a handful of times per evaluation and needs no WASM.
 */
import type { IndexedTriangles } from '../../core'
import type { Vec3 } from '../../geometry/vec'

/** A centreline with a section orientation per sample (rows of xyz). */
export interface Centreline {
  points: Float64Array
  /** Reference direction for the section's second axis; made perpendicular to the tangent. */
  ups: Float64Array
  closed: boolean
}

/** Section half-extents across the wire (side) and along `up`; squareness 2 = ellipse. */
export interface Section {
  side: number
  up: number
  /** Superellipse exponent: 2 is an ellipse, larger values approach a rounded rectangle. */
  squareness?: number
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
    lengths.push(lengths[i - 1]! + Math.hypot(p[0] - previous[0], p[1] - previous[1], p[2] - previous[2]))
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

/** Arc length of a sampled centreline. */
export function centrelineLength({ points, closed }: Centreline): number {
  const n = points.length / 3
  let sum = 0
  for (let i = 1; i < n + (closed ? 1 : 0); i++) {
    const a = at(points, i - 1)
    const b = at(points, i % n)
    sum += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return sum
}

/** Samples around a section of half-size `r` so the facets stay within `chord` of the surface. */
export function segmentsFor(radius: number, chord: number, min: number, max: number): number {
  const ratio = Math.min(1, chord / Math.max(radius, 1e-6))
  const step = 2 * Math.acos(1 - ratio)
  return Math.max(min, Math.min(max, Math.ceil((2 * Math.PI) / step)))
}

/**
 * Sweeps a section along a centreline. Closed centrelines give a torus-like surface; open ones
 * are closed with flat caps. The result is welded, watertight and wound outward.
 */
export function tubeMesh(line: Centreline, section: Section, around: number): IndexedTriangles {
  const { points, ups, closed } = line
  const n = points.length / 3
  const p = section.squareness ?? 2
  const ring = new Float64Array(around * 2)
  for (let j = 0; j < around; j++) {
    const v = (2 * Math.PI * j) / around
    const c = Math.cos(v)
    const s = Math.sin(v)
    // Superellipse |x/a|^p + |y/b|^p = 1 in polar form.
    ring[j * 2] = Math.sign(c) * Math.abs(c) ** (2 / p) * section.side
    ring[j * 2 + 1] = Math.sign(s) * Math.abs(s) ** (2 / p) * section.up
  }

  const caps = closed ? 0 : 2
  const positions = new Float32Array((n * around + caps) * 3)
  for (let i = 0; i < n; i++) {
    const prev = closed ? (i + n - 1) % n : Math.max(0, i - 1)
    const next = closed ? (i + 1) % n : Math.min(n - 1, i + 1)
    let tx = points[next * 3]! - points[prev * 3]!
    let ty = points[next * 3 + 1]! - points[prev * 3 + 1]!
    let tz = points[next * 3 + 2]! - points[prev * 3 + 2]!
    const tl = Math.hypot(tx, ty, tz) || 1
    tx /= tl
    ty /= tl
    tz /= tl
    // up ⟂ tangent, side = up × tangent: (side, up, tangent) is right-handed.
    let ux = ups[i * 3]!
    let uy = ups[i * 3 + 1]!
    let uz = ups[i * 3 + 2]!
    const d = ux * tx + uy * ty + uz * tz
    ux -= d * tx
    uy -= d * ty
    uz -= d * tz
    const ul = Math.hypot(ux, uy, uz) || 1
    ux /= ul
    uy /= ul
    uz /= ul
    const sx = uy * tz - uz * ty
    const sy = uz * tx - ux * tz
    const sz = ux * ty - uy * tx
    for (let j = 0; j < around; j++) {
      const a = ring[j * 2]!
      const b = ring[j * 2 + 1]!
      const o = (i * around + j) * 3
      positions[o] = points[i * 3]! + sx * a + ux * b
      positions[o + 1] = points[i * 3 + 1]! + sy * a + uy * b
      positions[o + 2] = points[i * 3 + 2]! + sz * a + uz * b
    }
  }

  const spans = closed ? n : n - 1
  const indices = new Uint32Array((spans * around * 2 + caps * around) * 3)
  let t = 0
  const tri = (a: number, b: number, c: number) => {
    indices[t++] = a
    indices[t++] = b
    indices[t++] = c
  }
  for (let i = 0; i < spans; i++) {
    const i1 = (i + 1) % n
    for (let j = 0; j < around; j++) {
      const j1 = (j + 1) % around
      const a = i * around + j
      const b = i * around + j1
      const c = i1 * around + j1
      const d = i1 * around + j
      tri(a, b, d)
      tri(b, c, d)
    }
  }
  if (!closed) {
    const start = n * around
    const end = start + 1
    positions.set(points.subarray(0, 3), start * 3)
    positions.set(points.subarray((n - 1) * 3, n * 3), end * 3)
    const last = (n - 1) * around
    for (let j = 0; j < around; j++) {
      const j1 = (j + 1) % around
      tri(start, j1, j)
      tri(end, last + j, last + j1)
    }
  }
  return { positions, indices }
}
