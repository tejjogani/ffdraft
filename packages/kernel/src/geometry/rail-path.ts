import { pointFromCurvePlane, pointOnNurbs } from '@pave/schema'
import type { NodeResult } from '../core'
import { clamp, distance, dot, lerp3, normalize, sub, transformPoint, type Vec3 } from './vec'

export type CurveInput = Pick<NodeResult, 'node' | 'matrix'>
export interface Station {
  t: number
  point: Vec3
}
export interface RailPath {
  at(t: number): Vec3
  samples: Station[]
}

const GUIDE_CHORD = 0.002
const MAX_SAMPLES = 1024

/** Samples a curve without changing its parameterization or losing polyline and knot boundaries. */
export function railPath({ node, matrix }: CurveInput): RailPath {
  let pointAt: (t: number) => Vec3
  let breaks: number[]
  if (node.kind === 'nurbsCurve') {
    const first = node.knots[node.degree - 1]!
    const last = node.knots[node.controlPoints.length - 1]!
    pointAt = (t) => pointOnNurbs(node, first + (last - first) * t)
    breaks = [...new Set(node.knots.filter((k) => k >= first && k <= last))].map(
      (k) => (k - first) / (last - first),
    )
  } else if (node.kind === 'curve') {
    const points = node.points.map(({ u, v }) =>
      pointFromCurvePlane(node.plane, [u, v], node.planeOffset),
    )
    if (node.closed) points.push(points[0]!)
    const last = points.length - 1
    breaks = points.map((_, i) => i / last)
    pointAt = (t) => {
      const index = Math.min(last - 1, Math.floor(t * last))
      return lerp3(points[index]!, points[index + 1]!, t * last - index)
    }
  } else throw new Error('Select construction or NURBS curves for the rails and sections.')

  const at = (t: number) => transformPoint(matrix, pointAt(clamp(t, 0, 1)))
  const samples: Station[] = [{ t: 0, point: at(0) }]
  function subdivide(a: Station, b: Station, depth: number) {
    const nearChord = (fraction: number) =>
      distance(at(a.t + (b.t - a.t) * fraction), lerp3(a.point, b.point, fraction)) <= GUIDE_CHORD
    if (b.t - a.t > 1 / 16 || ![0.25, 0.5, 0.75].every(nearChord)) {
      if (depth >= 15 || samples.length >= MAX_SAMPLES)
        throw new Error('A rail or section needs too many stations to follow within 0.01 mm.')
      const t = (a.t + b.t) / 2
      const middle = { t, point: at(t) }
      subdivide(a, middle, depth + 1)
      subdivide(middle, b, depth + 1)
    } else samples.push(b)
  }
  for (const t of breaks.slice(1)) subdivide(samples.at(-1)!, { t, point: at(t) }, 0)
  if (samples.length > MAX_SAMPLES)
    throw new Error('A rail or section needs too many stations to follow within 0.01 mm.')
  return { at, samples }
}

export function reverseRail(path: RailPath): RailPath {
  return {
    at: (t) => path.at(1 - t),
    samples: path.samples.map(({ t, point }) => ({ t: 1 - t, point })).reverse(),
  }
}

export const railTangent = (path: Pick<RailPath, 'at'>, t: number): Vec3 =>
  normalize(sub(path.at(t + 1e-6), path.at(t - 1e-6)))

/** Project a point known to lie on the rail, then refine the nearest sampled span. */
export function railParameter(path: RailPath, point: Vec3): number {
  let best = Infinity
  let index = 0
  for (let i = 0; i + 1 < path.samples.length; i++) {
    const { point: a } = path.samples[i]!
    const { point: b } = path.samples[i + 1]!
    const d = sub(b, a)
    const u = clamp(dot(sub(point, a), d) / Math.max(dot(d, d), 1e-20), 0, 1)
    const error = distance(point, lerp3(a, b, u))
    if (error < best) {
      index = i
      best = error
    }
  }
  const a = path.samples[index]!
  const b = path.samples[index + 1]!
  if (distance(a.point, point) < 1e-8) return a.t
  if (distance(b.point, point) < 1e-8) return b.t
  let lo = a.t
  let hi = b.t
  for (let i = 0; i < 40; i++) {
    const l = (2 * lo + hi) / 3
    const r = (lo + 2 * hi) / 3
    if (distance(point, path.at(l)) < distance(point, path.at(r))) hi = r
    else lo = l
  }
  return (lo + hi) / 2
}

/** The second guide must meet the moving plane exactly once in the active span. */
export function crossRail(
  path: RailPath,
  origin: Vec3,
  normal: Vec3,
  start: number,
  end: number,
): Station {
  const inPlane = (p: Vec3) => dot(sub(p, origin), normal)
  const inside = path.samples.filter(({ t }) => t > start && t < end)
  const samples = [{ t: start, point: path.at(start) }, ...inside, { t: end, point: path.at(end) }]
  const hits: number[] = []
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]!
    const b = samples[i + 1]
    const da = inPlane(a.point)
    if (Math.abs(da) <= 1e-8) hits.push(a.t)
    if (!b) continue
    const db = inPlane(b.point)
    if (Math.abs(da) <= 1e-8 || Math.abs(db) <= 1e-8 || da * db >= 0) continue
    let lo = a.t
    let hi = b.t
    for (let j = 0; j < 36; j++) {
      const mid = (lo + hi) / 2
      if (inPlane(path.at(mid)) * da > 0) lo = mid
      else hi = mid
    }
    hits.push((lo + hi) / 2)
  }
  if (hits.length !== 1)
    throw new Error(
      'The second rail must meet each moving section plane once. Check for folds, crossings or mismatched ends.',
    )
  const t = hits[0]!
  return { t, point: path.at(t) }
}
