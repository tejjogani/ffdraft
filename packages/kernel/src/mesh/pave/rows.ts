/**
 * Outline rows: walks the level sets of the distance to a pavé region's edge across the sampled
 * surface, so stones can be laid in rows that follow the outline (docs/research/06-freeform.md
 * §5 step 2). A row at distance L from the edge of a letter's stroke runs down one side of the
 * stroke, around its end and up the other side; two rows staggered across a stroke, or a row
 * hugging the rim of a heart, are what setters lay by hand and what a honeycomb grown from the
 * middle cannot give where the region is only a few stones wide.
 */
import { add, cross, dot, normalize, scale, type Vec3 } from '../../geometry/vec'
import type { PaveSurface } from './surface'

export interface LevelWalk {
  surface: PaveSurface
  /** Exact distance from a surface point to the region's edge. */
  edgeDistance: (p: Vec3) => number
  /** The distance from the edge the walk follows, mm. */
  level: number
  /** Distance between successive points of the walk, mm. */
  step: number
  /** Samples a walk may start from (all when absent). */
  starts?: readonly number[]
  /**
   * Called for every point of the walk, in order along each row; returns how far ahead the
   * next point may be (0 for the usual step) — after placing a stone, nothing fits for most of
   * a stone's width, so the walk can stride over it.
   */
  visit: (p: Vec3, n: Vec3, sample: number) => number
  checkpoint?: () => void
}

/** Finite-difference step for the edge-distance gradient, mm (well below any stone). */
const H = 0.01
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
  const trail: Trail = {
    walk: new Int32Array(s.count).fill(-1),
    at: new Int32Array(s.count),
    clock: 0,
  }
  // No loop is longer than the region can hold at this step; the bound only stops runaways.
  const maxSteps = Math.ceil((4 * s.count * s.spacing) / o.step) + 16
  let walks = 0
  // Starts are tried in a fixed order (the surface's own seeded sampling), so walks are repeatable.
  const starts = o.starts ?? Array.from({ length: s.count }, (_, i) => i)
  for (const i of starts) {
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
    const stride = skipFirst && k === 0 ? o.step : Math.max(o.step, o.visit(at.p, at.n, at.sample))
    mark(at.sample)
    // The samples a stride passes over are marked too, so no later walk starts among them.
    s.near(add(at.p, scale(dir, (stride - o.step) / 2)), reach + (stride - o.step) / 2, (j) => {
      if (Math.abs(s.edge[j]! - o.level) <= s.spacing) mark(j)
    })
    trail.clock++
    const next =
      advance(o, at, dir, stride) ?? (stride > o.step ? advance(o, at, dir, o.step) : null)
    if (!next) return false
    at = next.at
    dir = next.dir
  }
  return false
}

/** The point `length` further along the level, or null where the level ends or kinks. */
function advance(
  o: LevelWalk,
  at: OnLevel,
  dir: Vec3,
  length: number,
): { at: OnLevel; dir: Vec3 } | null {
  const next = project(o, add(at.p, scale(dir, length)))
  if (!next) return null
  const nextDir = scale(next.along, dot(next.along, dir) >= 0 ? 1 : -1)
  return dot(nextDir, dir) < MIN_TURN_COS ? null : { at: next, dir: nextDir }
}

/** The point of the level nearest to q, with its surface normal and direction along the level. */
function project(o: LevelWalk, q: Vec3): OnLevel | null {
  let p = q
  for (let k = 0; k < PROJECT_ITERATIONS; k++) {
    const hit = o.surface.snap(p)
    if (!hit) return null
    const e = o.edgeDistance(hit.p)
    const g = gradient(o, hit.p, hit.n, e)
    const slope2 = dot(g, g)
    if (slope2 < MIN_SLOPE * MIN_SLOPE) return null
    if (Math.abs(e - o.level) < LEVEL_TOLERANCE)
      return { p: hit.p, n: hit.n, sample: hit.sample, along: normalize(cross(g, hit.n)) }
    p = add(hit.p, scale(g, (o.level - e) / slope2))
  }
  return null
}

/** The gradient of the edge distance in the tangent plane at p, where it is `e` (forward differences). */
function gradient(o: LevelWalk, p: Vec3, n: Vec3, e: number): Vec3 {
  const e1 = normalize(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))
  const e2 = cross(n, e1)
  const d = (t: Vec3) => (o.edgeDistance(add(p, scale(t, H))) - e) / H
  return add(scale(e1, d(e1)), scale(e2, d(e2)))
}
