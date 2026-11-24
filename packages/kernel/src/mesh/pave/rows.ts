/**
 * Outline rows: walks the level sets of the distance to a pavé region's edge across the sampled
 * surface, so stones can be laid in rows that follow the outline (docs/research/06-freeform.md
 * §5 step 2). A row at distance L from the edge of a letter's stroke runs down one side of the
 * stroke, around its end and up the other side; two rows staggered across a stroke, or a row
 * hugging the rim of a heart, are what setters lay by hand and what a honeycomb grown from the
 * middle cannot give where the region is only a few stones wide.
 */
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../../geometry/vec'
import type { PaveSurface } from './surface'

export interface LevelWalk {
  surface: PaveSurface
  /** Exact distance from a surface point to the region's edge. */
  edgeDistance: (p: Vec3) => number
  /** The distance from the edge the walk follows, mm. */
  level: number
  /** Distance between successive points of the walk, mm. */
  step: number
  /** Called for every point of the walk, in order along each row. */
  visit: (p: Vec3, n: Vec3, sample: number) => void
  checkpoint?: () => void
}

/** Finite-difference step for the edge-distance gradient, mm. */
const H = 0.02
/** Newton steps that bring a point onto the level. */
const PROJECT_ITERATIONS = 4
const LEVEL_TOLERANCE = 1e-4
/** Where the distance field has no clear slope (the middle of a band) a level cannot be followed. */
const MIN_SLOPE = 0.25
/** A turn sharper than this between two steps is a kink of the level set: the row ends there. */
const MIN_TURN_COS = 0.3

interface OnLevel {
  p: Vec3
  n: Vec3
  sample: number
  /** Unit direction along the level, edge on the right. */
  along: Vec3
}

/** Walks every loop of the level set once, calling `visit` along it. */
export function walkLevelSets(o: LevelWalk): void {
  const s = o.surface
  const trail: Trail = { walk: new Int32Array(s.count).fill(-1), at: new Int32Array(s.count), clock: 0 }
  // No loop is longer than the region can hold at this step; the bound only stops runaways.
  const maxSteps = Math.ceil((4 * s.count * s.spacing) / o.step) + 16
  let walks = 0
  // Samples are visited in index order, which is fixed by the surface's own seeded sampling.
  for (let i = 0; i < s.count; i++) {
    if (trail.walk[i]! >= 0 || Math.abs(s.edge[i]! - o.level) > s.spacing) continue
    const start = project(o, s.point(i))
    if (!start) continue
    const id = walks++
    // An open row (one that ends at a kink) is walked both ways from where it was found.
    if (!walk(o, start, 1, trail, id, maxSteps)) walk(o, start, -1, trail, id, maxSteps, true)
  }
}

/** Which walk last passed near each sample, and when (in steps of all walks). */
interface Trail {
  walk: Int32Array
  at: Int32Array
  clock: number
}

/**
 * Follows the level from `start` in one direction until it ends or comes back onto its own
 * trail; true when it closed. A loop another walk already followed is not walked again.
 */
function walk(
  o: LevelWalk,
  start: OnLevel,
  sense: 1 | -1,
  trail: Trail,
  id: number,
  maxSteps: number,
  skipFirst = false,
): boolean {
  const s = o.surface
  const reach = Math.max(s.spacing, o.step) + s.spacing
  // Steps it takes to leave the samples marked around a point.
  const fresh = Math.ceil((2 * reach) / o.step) + 2
  const mark = (j: number) => {
    if (trail.walk[j] === id) return
    trail.walk[j] = id
    trail.at[j] = trail.clock
  }
  let at = start
  let dir = scale(start.along, sense)
  for (let k = 0; k < maxSteps; k++) {
    if (k % 64 === 0) o.checkpoint?.()
    const owner = trail.walk[at.sample]!
    if (owner === id && k > fresh && trail.clock - trail.at[at.sample]! > fresh) return true
    if (owner >= 0 && owner !== id) return false
    if (!(skipFirst && k === 0)) o.visit(at.p, at.n, at.sample)
    mark(at.sample)
    s.near(at.p, reach, (j) => {
      if (Math.abs(s.edge[j]! - o.level) <= s.spacing) mark(j)
    })
    trail.clock++
    const next = project(o, add(at.p, scale(dir, o.step)))
    if (!next) return false
    const nextDir = scale(next.along, dot(next.along, dir) >= 0 ? 1 : -1)
    if (dot(nextDir, dir) < MIN_TURN_COS) return false
    at = next
    dir = nextDir
  }
  return false
}

/** The point of the level nearest to q, with its surface normal and direction along the level. */
function project(o: LevelWalk, q: Vec3): OnLevel | null {
  let p = q
  for (let k = 0; k < PROJECT_ITERATIONS; k++) {
    const hit = o.surface.snap(p)
    if (!hit) return null
    const e = o.edgeDistance(hit.p)
    const g = gradient(o, hit.p, hit.n)
    const slope2 = dot(g, g)
    if (slope2 < MIN_SLOPE * MIN_SLOPE) return null
    if (Math.abs(e - o.level) < LEVEL_TOLERANCE)
      return { p: hit.p, n: hit.n, sample: hit.sample, along: normalize(cross(g, hit.n)) }
    p = add(hit.p, scale(g, (o.level - e) / slope2))
  }
  return null
}

/** The gradient of the edge distance in the tangent plane at p. */
function gradient(o: LevelWalk, p: Vec3, n: Vec3): Vec3 {
  const e1 = normalize(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))
  const e2 = cross(n, e1)
  const d = (e: Vec3) =>
    (o.edgeDistance(add(p, scale(e, H))) - o.edgeDistance(sub(p, scale(e, H)))) / (2 * H)
  return add(scale(e1, d(e1)), scale(e2, d(e2)))
}
