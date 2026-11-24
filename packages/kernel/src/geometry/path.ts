/**
 * Frames along a 3D path, for carrying a profile along it (see ./sweep.ts): wire along a curve,
 * a wall around a stone's outline, a prong up the side of a stone.
 *
 * Each frame's x and y span the section plane (z is the direction of travel). How the section
 * is rolled about the path is chosen by the caller:
 *  - `up`     y follows a given "up" and x = travel × up — for profiles drawn as (outward, up)
 *             around an outline that runs counter-clockwise seen from `up`;
 *  - `side`   x follows a given direction — for profiles that must face a known way;
 *  - neither  the frame is transported without twist (rotation-minimising), for round wire.
 */
import { chordParameters, cubicSpline } from './bspline'
import {
  add,
  addScaled,
  cross,
  dot,
  type Frame,
  length,
  normalize,
  perpendicular,
  scale,
  sub,
  type Vec3,
} from './vec'

export interface PathOptions {
  closed: boolean
  /** Per point (or one for all): the profile's y direction. */
  up?: Vec3 | readonly Vec3[]
  /** Per point (or one for all): the profile's x direction. */
  side?: Vec3 | readonly Vec3[]
  /** Indices of sharp corners: the section lies in the corner's bisector plane, mitred. */
  kinks?: readonly number[]
  /** Exact unit tangents per point, when the path came from a curve; else chords are used. */
  tangents?: readonly Vec3[]
}

const at = (v: Vec3 | readonly Vec3[] | undefined, i: number): Vec3 | undefined =>
  v === undefined ? undefined : typeof v[0] === 'number' ? (v as Vec3) : (v as readonly Vec3[])[i]

/** Removes from `v` its component along the unit vector `n`. */
const reject = (v: Vec3, n: Vec3): Vec3 => sub(v, scale(n, dot(v, n)))

/**
 * One frame per path point. At a kink the x axis is stretched by 1/cos(half the turn) so that a
 * profile keeps its true width on both legs of the corner.
 */
export function pathFrames(points: readonly Vec3[], options: PathOptions): Frame[] {
  const n = points.length
  const kinks = new Set(options.kinks ?? [])
  const neighbour = (i: number, step: number): Vec3 | null => {
    const j = i + step
    if (options.closed) return points[((j % n) + n) % n]!
    return j >= 0 && j < n ? points[j]! : null
  }
  const tangents: Vec3[] = []
  const mitres: number[] = []
  for (let i = 0; i < n; i++) {
    const prev = neighbour(i, -1)
    const next = neighbour(i, 1)
    const p = points[i]!
    const incoming = prev ? normalize(sub(p, prev)) : null
    const outgoing = next ? normalize(sub(next, p)) : null
    if (options.tangents) {
      tangents.push(options.tangents[i]!)
      mitres.push(1)
    } else if (incoming && outgoing && kinks.has(i)) {
      const t = normalize(add(incoming, outgoing), outgoing)
      tangents.push(t)
      mitres.push(1 / Math.max(0.3, dot(t, outgoing)))
    } else {
      // Smooth points use the chord through their neighbours.
      tangents.push(prev && next ? normalize(sub(next, prev)) : (outgoing ?? incoming ?? [0, 0, 1]))
      mitres.push(1)
    }
  }

  const frames: Frame[] = []
  let carried: Vec3 | null = null
  for (let i = 0; i < n; i++) {
    const t = tangents[i]!
    const up = at(options.up, i)
    const side = at(options.side, i)
    let x: Vec3
    if (up) x = normalize(cross(t, up), perpendicular(t))
    else if (side) x = normalize(reject(side, t), perpendicular(t))
    else {
      // Rotation-minimising: carry the previous x over, re-squared against the new tangent.
      x = carried ? normalize(reject(carried, t), perpendicular(t)) : perpendicular(t)
      carried = x
    }
    const y = up ? normalize(reject(up, t), cross(x, t)) : cross(t, x)
    frames.push({ origin: points[i]!, x: scale(x, mitres[i]!), y, z: t })
  }

  // A transported frame generally returns to the start rotated by some angle; spread that
  // twist evenly so a closed wire's first and last sections line up.
  if (options.closed && !options.up && !options.side && n > 2) {
    const first = frames[0]!
    const back = normalize(reject(frames[n - 1]!.x, first.z))
    const twist = Math.atan2(dot(cross(back, first.x), first.z), dot(back, first.x))
    frames.forEach((f, i) => {
      const a = (twist * i) / n
      const c = Math.cos(a)
      const s = Math.sin(a)
      const x = f.x
      f.x = add(scale(x, c), scale(f.y, s))
      f.y = add(scale(x, -s), scale(f.y, c))
    })
  }
  return frames
}

/** Total length of a polyline. */
export function pathLength(points: readonly Vec3[], closed: boolean): number {
  let total = 0
  for (let i = 0; i + 1 < points.length; i++) total += length(sub(points[i + 1]!, points[i]!))
  if (closed && points.length > 1) total += length(sub(points[0]!, points[points.length - 1]!))
  return total
}

/** `count` points evenly spaced by arc length along a polyline (closed: starting at point 0). */
export function resamplePath(points: readonly Vec3[], closed: boolean, count: number): Vec3[] {
  const all = closed ? [...points, points[0]!] : points
  const total = pathLength(points, closed)
  const out: Vec3[] = []
  let segment = 0
  let walked = 0
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (closed ? count : Math.max(1, count - 1))
    for (;;) {
      const l = length(sub(all[segment + 1]!, all[segment]!))
      if (walked + l >= target || segment + 2 >= all.length) {
        out.push(
          addScaled(
            all[segment]!,
            sub(all[segment + 1]!, all[segment]!),
            l > 0 ? Math.min(1, (target - walked) / l) : 0,
          ),
        )
        break
      }
      walked += l
      segment++
    }
  }
  return out
}

/**
 * A C² curve through `points`, sampled `perSpan` times between each pair: positions and exact
 * unit tangents. Closed curves do not repeat the first point.
 */
export function smoothPath(
  points: readonly Vec3[],
  closed: boolean,
  perSpan: number,
): { points: Vec3[]; tangents: Vec3[] } {
  const flat = new Float64Array(points.flat())
  const spline = cubicSpline(chordParameters(flat, 3, closed), closed)
  const poles = spline.solve(flat, 3)
  const out = { points: [] as Vec3[], tangents: [] as Vec3[] }
  const sample = (u: number) => {
    const basis = spline.basisAt(u)
    const p = [0, 0, 0]
    const d = [0, 0, 0]
    for (let i = 0; i < 4; i++) {
      const pole = (spline.periodic ? (basis.first + i) % spline.poleCount : basis.first + i) * 3
      for (let c = 0; c < 3; c++) {
        p[c]! += basis.w[i]! * poles[pole + c]!
        d[c]! += basis.dw[i]! * poles[pole + c]!
      }
    }
    out.points.push(p as unknown as Vec3)
    out.tangents.push(normalize(d as unknown as Vec3))
  }
  const knots = spline.knots
  for (let j = 0; j + 1 < knots.length; j++)
    for (let m = 0; m < perSpan; m++)
      sample(knots[j]! + ((knots[j + 1]! - knots[j]!) * m) / perSpan)
  if (!closed) sample(knots[knots.length - 1]!)
  return out
}
