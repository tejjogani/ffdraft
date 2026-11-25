/**
 * Halo: rows of small stones on offsets of the centre stone's outline, seated in a metal ring.
 * Beads are raised between neighbouring stones at production detail.
 *
 * The inner row starts at the node's gap to the centre stone (`offset`), as a setter builds it:
 * the centre's claws come up through the halo's inner edge, each standing in a notch between two
 * halo stones, so no claw crosses a stone and the halo stays a frame, not a tyre (canon
 * `halo.outline`: 1.4–1.6× the centre). A bezel is continuous, so there the row starts beyond its
 * wall. The ring's inner edge tucks under the centre's girdle, clear of its pavilion, to give the
 * inner row its seat wall. (Pieces from before claw clearance keep their old layout through
 * `clearClaws: false`.) On a band the ring is lifted off it where it would sink in, and stands
 * on posts where it hangs above it, so it casts as one piece with the band whatever alloy the
 * head is.
 */
import { gemDims } from '@pave/schema'
import { type Addition, type Cut, defineFeature, metalOf, type Solid, type Stone } from '../core'
import { seatCutter, seatHole } from '../gems/cutter'
import { concaveCorners, polygonDistance, type StoneShape, stoneShape } from '../gems/shape'
import { roundedRectLoop, translateLoop } from '../geometry/loop'
import { pathFrames, pathLength, resamplePath } from '../geometry/path'
import { pinSolid } from '../geometry/pin'
import { placeLoop, sweepSolid } from '../geometry/sweep'
import {
  add,
  addScaled,
  clamp,
  cross,
  distance,
  normalize,
  scale,
  sub,
  type Vec2,
  type Vec3,
} from '../geometry/vec'
import { RULES } from '../rules'
import { culetDepth, gemData } from './gem'
import type { ClawPlace, HeadData } from './setting'

/**
 * Metal left beyond the outermost stones and inside the innermost, mm: the 0.4 mm seat wall a
 * setter needs (dfm `seatWall`) plus what the 0.98 seat cutter leaves.
 */
const BORDER = 0.45
/** The border of halos made before claw clearance, kept so they build exactly as they did. */
const LEGACY_BORDER = 0.25
/** Metal under the culets, mm. */
const FLOOR = 0.35
/** How far the ring may sink into the band before it is lifted instead, mm. */
const MAX_SINK = 0.3
/** Posts that stand a hanging ring on the band: radius, and how deep they root in it, mm. */
const POST_RADIUS = 0.4
const POST_SINK = 0.3
/**
 * Air between a halo stone and a claw standing in the notch beside it, mm. The claw is measured
 * at the girdle, where it stands furthest out; its root below is a few hundredths stouter.
 */
const CLAW_CLEARANCE = 0.08
/** Widest gap between neighbouring halo stones before they read as spaced dots, mm. */
const MAX_GAP = 0.35
/** Widest gap between neighbouring halo stones spread to take up slack beside a claw, mm. */
const MAX_PLAIN = 0.38
/**
 * Most slack a run of stones leaves beside a claw, mm: with the claw's clearance it stays under
 * the 0.4 mm of bare plate a setter reads as a missing stone.
 */
const MAX_LEAD = 0.26
/** Closest neighbouring halo stones may be drawn together to keep the outline's symmetry, mm. */
const MIN_GAP = 0.05
/**
 * Most the rows may stand off their path midway between a point claw and its neighbours when
 * they step out round it, mm; past it the claw stands in a notch instead.
 */
const MAX_SIDE_PUSH = 0.1
/** Air between the ring's inner edge, tucked under the centre's girdle, and its pavilion, mm. */
const PAVILION_CLEARANCE = 0.05

/** Rotational symmetry steps of the outline: 4 for a square, 2 for an oval, 1 otherwise. */
function symmetryStep(shape: StoneShape): number {
  const outline = shape.unit.outline
  const square = Math.abs(outline.length - 1) < 1e-6 && Math.abs(outline.centre[1]) < 1e-9
  const twoFold = Math.abs(outline.centre[1]) < 1e-9
  return shape.stone.cut === 'round' ? 1 : square ? 4 : twoFold ? 2 : 1
}

/** The stone count of halos made before claw clearance: the symmetric count, rounded down. */
function legacyCount(shape: StoneShape, fit: number): number {
  const step = symmetryStep(shape)
  return Math.floor(fit / step) * step
}

/**
 * Stones spread evenly round a closed path of length `total` by `place(count)`, respecting the
 * outline's symmetry: a square halo wants a multiple of four so every corner looks the same, an
 * oval a multiple of two. Rounding down to the symmetry can leave up to three stones' worth of
 * gaps on a square, so when that spaces the stones past `MAX_GAP` the next symmetric count up
 * is taken, else two-fold symmetry (the layout starts on the length axis, so it still mirrors
 * both ways), each only if its stones stand `MIN_GAP` apart in space: round a corner they stand
 * closer than along the path.
 */
function evenLayout(
  shape: StoneShape,
  total: number,
  size: number,
  gap: number,
  place: (count: number) => Vec3[],
): Vec3[] {
  const step = symmetryStep(shape)
  const fit = total / (size + gap)
  const down = Math.floor(fit / step) * step
  const asked = place(down)
  if (step === 1 || total / down - size <= Math.max(gap, MAX_GAP)) return asked
  const apart = (centres: Vec3[]) =>
    centres.every((c, i) => distance(c, centres[(i + 1) % centres.length]!) >= size + MIN_GAP)
  for (const count of [down + step, Math.floor(fit / 2) * 2]) {
    const centres = place(count)
    if (count > down && apart(centres)) return centres
  }
  return asked
}

/** How far a stone centred at a point of the stone's plane stands clear of something; < 0: it touches. */
type Obstacle = (p: Vec2) => number

/** The convex hull of a mesh's section at height `z` (flat triangles in the stone's frame). */
function sectionHull(surface: Float32Array, z: number): Vec2[] {
  const points: Vec2[] = []
  for (let t = 0; t < surface.length; t += 9)
    for (let e = 0; e < 3; e++) {
      const a = t + e * 3
      const b = t + ((e + 1) % 3) * 3
      const za = surface[a + 2]!
      const zb = surface[b + 2]!
      if ((za - z) * (zb - z) > 0 || za === zb) continue
      const k = (z - za) / (zb - za)
      points.push([
        surface[a]! + (surface[b]! - surface[a]!) * k,
        surface[a + 1]! + (surface[b + 1]! - surface[a + 1]!) * k,
      ])
    }
  // Neighbouring triangles share their edges: each crossing is found twice.
  const unique = [...new Map(points.map((q) => [`${q[0].toFixed(3)},${q[1].toFixed(3)}`, q])).values()]
  return unique.length >= 3 ? convexHull(unique) : unique
}

/** Signed distance from a point to a convex counter-clockwise polygon (negative inside). */
function convexDistance(hull: readonly Vec2[], q: Vec2): number {
  if (hull.length === 0) return Infinity
  if (hull.length < 3) return Math.min(...hull.map((p) => Math.hypot(p[0] - q[0], p[1] - q[1])))
  let inside = -Infinity
  hull.forEach((a, i) => {
    const b = hull[(i + 1) % hull.length]!
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    inside = Math.max(inside, ((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) / l)
  })
  return inside <= 0 ? inside : polygonDistance(hull, q)
}

/**
 * A claw as an obstacle for halo stones of `stone`'s cut and size whose girdles stand at
 * `girdleZ` (the centre's frame). Legs lean in and, on a band, sideways toward its metal, and the
 * section turns where the claw bends over the crown, so the claw is taken as built: its sections
 * at heights through the halo stone, each against the stone's own width at that height.
 * Without a surface (a head that built none) it is its section at the girdle, a rounded
 * rectangle `radius` out from its axis and `halfWidth` along the girdle.
 */
function clawObstacle(
  shape: StoneShape,
  claw: ClawPlace,
  small: StoneShape,
  girdleZ: number,
): Obstacle {
  const size = Math.max(small.stone.dims.width, small.stone.dims.length)
  const clear = (d: number, half: number) => d - half - CLAW_CLEARANCE
  if (!claw.surface) {
    const g = shape.point(claw.phi)
    const n = shape.normal(claw.phi)
    const t: Vec2 = [-n[1], n[0]]
    const off = claw.reach - claw.radius
    const axis: Vec2 = [g[0] + n[0] * off, g[1] + n[1] * off]
    const r = Math.min(claw.corner, claw.radius)
    const hu = claw.radius - r
    const hv = Math.max(claw.halfWidth, claw.radius) - r
    return ([x, y]) => {
      const u = Math.abs((x - axis[0]) * n[0] + (y - axis[1]) * n[1]) - hu
      const v = Math.abs((x - axis[0]) * t[0] + (y - axis[1]) * t[1]) - hv
      const d = Math.hypot(Math.max(0, u), Math.max(0, v)) + Math.min(0, Math.max(u, v)) - r
      return clear(d, size / 2)
    }
  }
  // From just under the halo stone's girdle to its table.
  const levels = [-0.05, 0, small.girdleTop, ...[0.25, 0.5, 0.75, 1].map((f) => f * small.table)]
  const sections = levels.flatMap((dz) => {
    const hull = sectionHull(claw.surface!, girdleZ + dz)
    if (!hull.length) return []
    const c: Vec2 = [
      hull.reduce((t, q) => t + q[0], 0) / hull.length,
      hull.reduce((t, q) => t + q[1], 0) / hull.length,
    ]
    const radius = Math.max(...hull.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1])))
    return [{ hull, c, radius, half: (size / 2) * small.scaleAt(dz) }]
  })
  // Callers only ask whether a stone clears: far from the claw a bound from its circumscribed
  // circle answers that without walking the hull.
  return (p) =>
    Math.min(
      ...sections.map(({ hull, c, radius, half }) => {
        const far = clear(Math.hypot(p[0] - c[0], p[1] - c[1]) - radius, half)
        return far > 0 ? far : clear(convexDistance(hull, p), half)
      }),
    )
}

/** A closed path in the stone's plane, resampled about every `step` mm. */
function densify(flat: readonly Vec2[], step: number): Vec2[] {
  const path = flat.map(([x, y]): Vec3 => [x, y, 0])
  const count = Math.max(flat.length, Math.ceil(pathLength(path, true) / step))
  return resamplePath(path, true, count).map(([x, y]): Vec2 => [x, y])
}

/** Outward unit normal at point `i` of a counter-clockwise closed path (the outlines run so). */
function outwardAt(path: readonly Vec2[], i: number): Vec2 {
  const a = path[(i + path.length - 1) % path.length]!
  const b = path[(i + 1) % path.length]!
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]
}

const scale2 = ([x, y]: Vec2, k: number): Vec2 => [x * k, y * k]

/** How far a ray from `q` along unit `m` travels before it meets a closed polygon (∞: never). */
function rayToPolygon(polygon: readonly Vec2[], q: Vec2, m: Vec2): number {
  let t = Infinity
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const den = m[0] * ey - m[1] * ex
    if (Math.abs(den) < 1e-12) return
    const ax = a[0] - q[0]
    const ay = a[1] - q[1]
    const along = (ax * ey - ay * ex) / den
    const at = (ax * m[1] - ay * m[0]) / den
    if (along > 0 && at >= 0 && at <= 1) t = Math.min(t, along)
  })
  return t
}

/** Convex hull of points, counter-clockwise (Andrew's monotone chain). */
function convexHull(points: readonly Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const turn = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Vec2[]) => {
    const out: Vec2[] = []
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

/** How far a ray from inside a convex counter-clockwise polygon travels before it leaves it. */
function exitDistance(hull: readonly Vec2[], q: Vec2, m: Vec2): number {
  let t = Infinity
  hull.forEach((a, i) => {
    const b = hull[(i + 1) % hull.length]!
    const n: Vec2 = [b[1] - a[1], -(b[0] - a[0])]
    const toward = m[0] * n[0] + m[1] * n[1]
    if (toward > 1e-12) t = Math.min(t, -((q[0] - a[0]) * n[0] + (q[1] - a[1]) * n[1]) / toward)
  })
  return Number.isFinite(t) ? Math.max(0, t) : 0
}

/**
 * How far the rows step outward round the claws on the stone's points and corners, by
 * direction from its centre. A claw on a point sits where the row turns round it, so a notch
 * there would empty the whole corner. Instead the row steps out just clear of the claw, and runs
 * straight from there to the row on either side (the convex hull of the row between the
 * neighbouring claws), as a halo round a princess, a pear or a trillion is drawn: square or
 * pointed corners, straight sides, no lump at the claw. The ring's outside follows the row.
 * `flat` is the inner row's path.
 */
function pointPush(
  shape: StoneShape,
  flat: readonly Vec2[],
  claws: readonly ClawPlace[],
  obstacle: (claw: ClawPlace) => Obstacle,
): (p: Vec2) => number {
  const onPoints = claws.filter((c) => c.point)
  if (onPoints.length === 0) return () => 0
  const turn = (v: number) => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const angle = (p: Vec2) => turn(Math.atan2(p[1] - shape.centre[1], p[0] - shape.centre[0]))
  const dense = densify(flat, 0.05)
  const normals = dense.map((_, i) => outwardAt(dense, i))
  const push = dense.map(() => 0)
  // Directions of every claw, in order round the stone: a point claw's row runs between its
  // neighbours.
  const phis = claws.map((c) => turn(Math.atan2(...dirOf(shape, c.phi)))).sort((a, b) => a - b)
  // A convex stone's row is one hull; round a heart's cleft the hull would fill the cleft, so
  // each point claw's stretch of row is taken on its own, between its neighbouring claws.
  const convex = concaveCorners(shape).length === 0
  for (const claw of convex ? [null] : onPoints) {
    const clear = (p: Vec2) => Math.min(...(claw ? [claw] : onPoints).map((c) => obstacle(c)(p)))
    const own = claw ? turn(Math.atan2(...dirOf(shape, claw.phi))) : 0
    const at = phis.findIndex((p) => Math.abs(p - own) < 1e-9)
    const before = phis.length > 1 ? phis[(at + phis.length - 1) % phis.length]! : own + Math.PI
    const after = phis.length > 1 ? phis[(at + 1) % phis.length]! : own + Math.PI
    const from = turn(own - before) || 2 * Math.PI
    const to = turn(after - own) || 2 * Math.PI
    const window = dense.flatMap((q, i) => {
      const a = angle(q)
      return !claw || turn(a - own) <= to || turn(own - a) <= from ? [i] : []
    })
    // Each point stepped out along its normal until a stone there clears the claw.
    const stepped = window.map((i) => {
      const q = dense[i]!
      const m = normals[i]!
      const free = (k: number) => clear([q[0] + m[0] * k, q[1] + m[1] * k]) >= 0
      if (free(0)) return q
      let lo = 0
      let hi = 3
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2
        if (free(mid)) hi = mid
        else lo = mid
      }
      return [q[0] + m[0] * hi, q[1] + m[1] * hi] as Vec2
    })
    if (stepped.every((p, k) => p === dense[window[k]!])) continue
    const hull = convexHull(stepped)
    for (const i of window) push[i] = Math.max(push[i]!, exitDistance(hull, dense[i]!, normals[i]!))
  }
  const table = dense.map((q, i) => ({ a: angle(q), push: push[i]! })).sort((x, y) => x.a - y.a)
  return (p) => {
    const a = angle(p)
    const hi = Math.max(
      0,
      table.findIndex((t) => t.a >= a),
    )
    const lo = (hi + table.length - 1) % table.length
    const from = table[lo]!
    const to = table[hi]!
    const t = clamp(turn(a - from.a) / (turn(to.a - from.a) || 1e-9), 0, 1)
    return from.push + (to.push - from.push) * t
  }
}

/**
 * How far a row stepped out by `push` stands off its path midway between a point claw and each
 * of its neighbouring claws: more than a trace means the step carried a whole side out.
 */
function sidePush(
  shape: StoneShape,
  claws: readonly ClawPlace[],
  push: (p: Vec2) => number,
): (claw: ClawPlace) => number {
  const turn = (v: number) => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const dirs = claws.map((c) => turn(Math.atan2(...dirOf(shape, c.phi)))).sort((a, b) => a - b)
  const at = (a: number) =>
    push([shape.centre[0] + Math.cos(a), shape.centre[1] + Math.sin(a)])
  return (claw) => {
    const own = turn(Math.atan2(...dirOf(shape, claw.phi)))
    const i = dirs.findIndex((d) => Math.abs(d - own) < 1e-9)
    const before = dirs[(i + dirs.length - 1) % dirs.length]!
    const after = dirs[(i + 1) % dirs.length]!
    const from = turn(own - before) || 2 * Math.PI
    const to = turn(after - own) || 2 * Math.PI
    return Math.max(at(own - from / 2), at(own + to / 2))
  }
}

/** Direction (y, x for atan2) from the stone's centre to its girdle point at φ. */
function dirOf(shape: StoneShape, phi: number): [number, number] {
  const g = shape.point(phi)
  return [g[1] - shape.centre[1], g[0] - shape.centre[0]]
}

/** A closed polyline measured by arc length. */
function arcs(path: readonly Vec3[]) {
  const lengths = [0]
  for (let i = 0; i < path.length; i++)
    lengths.push(lengths[i]! + distance(path[i]!, path[(i + 1) % path.length]!))
  const total = lengths[path.length]!
  const at = (s: number): Vec3 => {
    const t = ((s % total) + total) % total
    let i = 0
    while (i + 1 < path.length && lengths[i + 1]! < t) i++
    const a = path[i]!
    const b = path[(i + 1) % path.length]!
    const l = lengths[i + 1]! - lengths[i]!
    return addScaled(a, sub(b, a), l > 0 ? (t - lengths[i]!) / l : 0)
  }
  return { total, at, s: (i: number) => lengths[i]! }
}

/**
 * Arc length at which a closed path crosses the stone's length axis on one side of its centre
 * (+1: larger y). The outlines are mirror-symmetric about that axis, so a layout started there
 * mirrors left to right.
 */
function axisCrossing(shape: StoneShape, flat: readonly Vec2[], side: 1 | -1): number {
  const [cx, cy] = shape.centre
  let length = 0
  let found = 0
  for (let i = 0; i < flat.length; i++) {
    const [ax, ay] = flat[i]!
    const [bx, by] = flat[(i + 1) % flat.length]!
    const l = Math.hypot(bx - ax, by - ay)
    if ((ax - cx) * (bx - cx) <= 0 && ax !== bx && side * ((ay + by) / 2 - cy) > 0)
      found = length + ((cx - ax) / (bx - ax)) * l
    length += l
  }
  return found
}

/** `s` relative to `c` on a closed path of length `total`, in (−total/2, total/2]. */
const around = (s: number, c: number, total: number): number =>
  ((((s - c) % total) + total * 1.5) % total) - total / 2

/**
 * Stone centres round one row's path, mirror-symmetric about the stone's length axis.
 *
 * With nothing in the way the stones are spread evenly from a point on the axis (so a pear or
 * marquise has a stone on each point). Otherwise the path is cut into free runs: at a cleft the
 * two stones beside it are set just far enough apart not to touch across it, and round each
 * claw standing in the row a notch is left just wide enough for it. Each run takes as many
 * stones as fit at the asked gap, no further apart than `MAX_GAP`, centred in the run, so any
 * slack falls beside the claws (which fill it) and both halves mirror.
 */
function rowCentres(
  shape: StoneShape,
  flat: readonly Vec2[],
  path: readonly Vec3[],
  size: number,
  gap: number,
  obstacles: readonly Obstacle[],
  seatable: (p: Vec2) => boolean,
): Vec3[] {
  const pitch = size + gap
  const { total, at } = arcs(path)
  const plan = arcs(flat.map(([x, y]): Vec3 => [x, y, 0]))
  const [, cy] = shape.centre
  const crosses = (s: number): boolean =>
    obstacles.some((o) => {
      const [x, y] = plan.at(s)
      return o([x, y]) < 0
    })
  const samples = Math.max(64, Math.ceil(total / 0.02))
  const ds = total / samples
  // Each stretch a claw blocks, as its centre and half-length. A claw that only grazes the row
  // (a leg leaning in under a lowered halo) blocks less than a stone's width, which would let the
  // stones either side of it overlap: such a notch is widened to a stone and its gap.
  const notches: { c: number; half: number }[] = []
  const hit = Array.from({ length: samples }, (_, i) => crosses(i * ds))
  const start = hit.indexOf(false)
  if (start >= 0)
    for (let i = start; i < start + samples; i++) {
      if (!hit[i % samples]) continue
      let j = i
      while (j + 1 < start + samples && hit[(j + 1) % samples]) j++
      // To a micron, so the stretches either side of the axis mirror exactly.
      const bisect = (out: number, inside: number) => {
        for (let k = 0; k < 16; k++) {
          const mid = (out + inside) / 2
          if (crosses(mid)) inside = mid
          else out = mid
        }
        return inside
      }
      const from = bisect((i - 1) * ds, i * ds)
      const to = bisect((j + 1) * ds, j * ds)
      notches.push({ c: (from + to) / 2, half: Math.max((to - from) / 2, pitch / 2) })
      i = j
    }
  const corners = concaveCorners(shape).map((phi) =>
    axisCrossing(shape, flat, shape.point(phi)[1] > cy ? 1 : -1),
  )
  if (corners.length === 0) return lay(false).map(({ p }) => p)
  // At a cleft the stones beside it are set just far enough apart not to touch across it, or one
  // stone sits in the V itself (where no claw stands there) with its neighbours a stone and its
  // gap from it. Whichever leaves less bare metal beside the claws near the cleft: on a small
  // heart the pair leaves the V bare for a stone's width, on a large one the single stone can
  // leave a stretch between it and the lobe claws.
  const pair = lay(false)
  const single = lay(true)
  return (bare(single) < bare(pair) - 1e-6 ? single : pair).map(({ p }) => p)

  /** Widest stretch between neighbouring stones that no claw stands in, mm (in space). */
  function bare(placed: { s: number; p: Vec3 }[]): number {
    return Math.max(
      ...placed.map(({ s, p }, i) => {
        const next = placed[(i + 1) % placed.length]!
        const reach = around(next.s, s, total)
        const claw = notches.find(({ c }) => {
          const k = around(c, s, total)
          return reach > 0 ? k > 0 && k < reach : false
        })
        // A claw fills its notch but for the air either side of it.
        const filled = claw ? Math.max(0, 2 * (claw.half - size / 2 - CLAW_CLEARANCE)) : 0
        return distance(p, next.p) - size - filled
      }),
    )
  }

  function lay(seat: boolean): { s: number; p: Vec3 }[] {
    const clefts = corners.map((c) => {
      const [x, y] = plan.at(c)
      const seated = seat && !crosses(c) && seatable([x, y])
      const apart = (h: number) =>
        seated
          ? Math.min(distance(at(c - h), at(c)), distance(at(c + h), at(c))) >= pitch
          : distance(at(c - h), at(c + h)) >= pitch
      let half = pitch / 2
      while (half < total / 4 && !apart(half)) half += 0.01
      return { c, half, seated }
    })
    const blocked = (s: number): boolean =>
      clefts.some(({ c, half }) => Math.abs(around(s, c, total)) < half) ||
      notches.some(({ c, half }) => Math.abs(around(s, c, total)) < half) ||
      (start < 0 && crosses(s))
    const free = Array.from({ length: samples }, (_, i) => !blocked(i * ds))
    const first = free.indexOf(false)
    if (first < 0) {
      // Start on the length axis at its larger-y end (a pear's point, a marquise's tip).
      const from = axisCrossing(shape, flat, 1)
      return evenLayout(shape, total, size, gap, (count) =>
        Array.from({ length: count }, (_, i) => at(from + (total * i) / count)),
      ).map((p, i, all) => ({ s: from + (total * i) / all.length, p }))
    }
    // Where the path passes from blocked (at `from`) to free (at `to`), to a micron, so the runs
    // either side of the axis mirror exactly.
    const edge = (from: number, to: number): number => {
      for (let k = 0; k < 16; k++) {
        const mid = (from + to) / 2
        if (blocked(mid)) from = mid
        else to = mid
      }
      return to
    }
    const placed: { s: number; p: Vec3 }[] = clefts
      .filter((k) => k.seated)
      .map(({ c }) => ({ s: c, p: at(c) }))
    const widest = size + Math.max(gap, MAX_GAP)
    const inCleft = (s: number) =>
      clefts.some(({ c, half }) => Math.abs(around(s, c, total)) < half)
    for (let i = first; i < first + samples; i++) {
      if (!free[i % samples]) continue
      let j = i
      while (j + 1 < first + samples && free[(j + 1) % samples]) j++
      const a = edge((i - 1) * ds, i * ds)
      const b = edge((j + 1) * ds, j * ds)
      const span = Math.max(0, b - a)
      // Slack goes beside the claws, which fill it, never beside a cleft: there the stones close
      // up to the stone across it, so the row carries on round the cleft.
      const clawEnds = [a - ds, b + ds].filter((s) => !inCleft(s)).length
      const shareAtA = clawEnds === 0 ? 0.5 : inCleft(a - ds) ? 0 : 1 / clawEnds
      // As many stones as fit at the asked gap, spread up to `MAX_GAP`; further, up to
      // `MAX_PLAIN`, where the slack left beside a claw would show as bare metal (`MAX_LEAD`);
      // or one more, drawn closer (never under `MIN_GAP`), when that is nearer the asked gap
      // than the spread and the slack together.
      const fit = Math.floor(span / pitch + 1e-9) + 1
      const off = (count: number) => {
        if (count < 2) return { count, step: 0, lead: span * shareAtA, cost: span / 2 }
        let step = Math.min(span / (count - 1), widest)
        const ends = Math.max(1, clawEnds)
        if ((span - step * (count - 1)) / ends > MAX_LEAD)
          step = Math.min(
            span / (count - 1),
            size + MAX_PLAIN,
            (span - ends * MAX_LEAD) / (count - 1),
          )
        const slack = span - step * (count - 1)
        const lead = slack * shareAtA
        // Measured in space: round a curve stones stand closer than along the path.
        const apart = Array.from({ length: count - 1 }, (_, k) =>
          distance(at(a + lead + step * k), at(a + lead + step * (k + 1))),
        ).every((d) => d >= size + MIN_GAP)
        if (count > fit && !apart) return { count, step, lead, cost: Infinity }
        return { count, step, lead, cost: Math.abs(step - size - gap) + slack / ends }
      }
      const { count, step, lead } = [off(fit), off(fit + 1)].reduce((x, y) =>
        y.cost < x.cost ? y : x,
      )
      for (let k = 0; k < count; k++) {
        const s = a + lead + step * k
        placed.push({ s, p: at(s) })
      }
      i = j
    }
    const from = first * ds + total / 2
    return placed.sort((x, y) => around(x.s, from, total) - around(y.s, from, total))
  }
}

/**
 * The ring's path with each cleft bridged: the offset of a heart's cleft is a deep V whose two
 * sides would run the ring's metal into each other. Cut it open where the two sides are a
 * ring's width apart and join them straight across.
 */
function bridgeClefts(shape: StoneShape, flat: readonly Vec2[], width: number): Vec2[] {
  const [, cy] = shape.centre
  let out = [...flat]
  for (const phi of concaveCorners(shape)) {
    const path = out.map(([x, y]): Vec3 => [x, y, 0])
    const { total, at } = arcs(path)
    const c = axisCrossing(shape, out, shape.point(phi)[1] > cy ? 1 : -1)
    let half = width / 2
    while (half < total / 4 && distance(at(c - half), at(c + half)) < width) half += 0.01
    // Arc length of each point, relative to the cleft, in (−total/2, total/2].
    let s = 0
    const kept: { p: Vec2; t: number }[] = []
    out.forEach((p, i) => {
      const t = ((((s - c) % total) + total * 1.5) % total) - total / 2
      if (Math.abs(t) >= half) kept.push({ p, t })
      s += Math.hypot(out[(i + 1) % out.length]![0] - p[0], out[(i + 1) % out.length]![1] - p[1])
    })
    // Rotate so the path starts just after the bridge, then lay the bridge at its end.
    const after = kept.filter((k) => k.t > 0).sort((a, b) => a.t - b.t)
    const before = kept.filter((k) => k.t < 0).sort((a, b) => a.t - b.t)
    const a = at(c - half)
    const b = at(c + half)
    const bridge = [0, 0.25, 0.5, 0.75].map(
      (f): Vec2 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
    )
    out = [[b[0], b[1]], ...after.map((k) => k.p), ...before.map((k) => k.p), ...bridge]
  }
  return out
}

/** The layout of pieces made before claw clearance: stones evenly round at the given offset. */
function legacyCentres(shape: StoneShape, path: readonly Vec3[], size: number, pitch: number) {
  let count = legacyCount(shape, pathLength(path, true) / pitch)
  let centres = resamplePath(path, true, count)
  // Spacing is measured along the path; where the path turns inward (a heart's cleft) stones
  // end up closer than that, so take stones out until none touch.
  const crowded = () =>
    centres.some((c, i) =>
      [1, 2, 3].some((k) => count > 2 * k && distance(c, centres[(i + k) % count]!) < size + 0.02),
    )
  while (count >= 3 && crowded()) {
    count = legacyCount(shape, count - 1)
    centres = resamplePath(path, true, count)
  }
  return centres
}

export const halo = defineFeature('halo', (node, ctx) => {
  const around = ctx.input(node.around)
  const centre = around.stones[0]
  if (!centre) throw new Error('the stone it surrounds was not built')
  const shape = stoneShape(centre)
  const host = around.data ? gemData(around).host : null
  const dims = gemDims(node.cut, node.stoneWidth)
  const size = Math.max(dims.width, dims.length)
  const pitch = size + node.gap
  const up = centre.frame.z
  const culet = culetDepth(node.cut, dims)
  const crown = dims.depth - culet
  const legacy = node.clearClaws === false

  // The head on the same stone: its claws stand in notches of the inner row; a bezel's wall is
  // continuous, so the row starts beyond it.
  const headData = node.head ? (ctx.tryInput(node.head)?.data as HeadData | undefined) : undefined
  const head = headData?.kind === 'head' ? headData : undefined
  const claws = head?.claws ?? []
  const clawReach = Math.max(0, ...claws.map((c) => c.reach))
  const wall = head?.wall ?? 0
  const gapInner = legacy || wall === 0 ? node.offset : Math.max(node.offset, wall + 0.05)
  if (gapInner > node.offset + 1e-6)
    ctx.report({
      level: 'info',
      code: 'halo.offset',
      message: `The halo starts ${gapInner.toFixed(2)} mm from the centre stone, just beyond its ${wall.toFixed(2)} mm bezel wall, not at the ${node.offset.toFixed(2)} mm gap asked.`,
      value: gapInner,
      limit: node.offset,
      fix: {
        label: `Set the gap to ${gapInner.toFixed(2)} mm`,
        ops: [{ t: 'update', id: node.id, patch: { offset: Number(gapInner.toFixed(2)) } }],
      },
    })
  // The inner row's seat wall runs in under the centre's girdle, so the ring's top must be low
  // enough that the pavilion has narrowed by that wall (and air) there. A thick girdle (a large
  // stone) takes the halo lower than its drop asks. Where the pavilion cannot give the whole wall
  // (a flat-backed cabochon has none; a long heart narrows too slowly under its lobes before the
  // ring would reach its culet), the row moves out by what is missing, as on a bezel.
  let drop = node.drop
  let inner = gapInner
  const wallIn = RULES.channelWall + 0.02 + PAVILION_CLEARANCE - inner
  if (!legacy && wallIn > 0) {
    const girdle = shape.polygon(8)
    const inset = (z: number) =>
      Math.min(
        ...girdle.phis.map((phi) => polygonDistance(girdle.points, shape.silhouette(phi, z))),
      )
    let top = shape.girdleBottom
    while (top > shape.culet / 2 && inset(top) < wallIn) top -= 0.02
    const gained = inset(top)
    // Lowering the halo only pays where the pavilion actually narrows.
    if (gained > 0.01) drop = Math.max(drop, 0.25 * crown - top)
    if (gained < wallIn) inner += wallIn - gained
  }
  if (drop > node.drop + 0.05)
    ctx.report({
      level: 'info',
      code: 'halo.lowered',
      message: `The halo sits ${drop.toFixed(2)} mm below the girdle, not ${node.drop.toFixed(2)} mm: the inner stones need their seat wall under the centre stone’s girdle, and it is thick.`,
      value: drop,
      limit: node.drop,
    })
  if (inner > gapInner + 1e-6)
    ctx.report({
      level: 'info',
      code: 'halo.offset',
      message: `The halo starts ${inner.toFixed(2)} mm from the centre stone, not at the ${node.offset.toFixed(2)} mm gap asked: the centre’s pavilion leaves no room under its girdle for the inner stones’ seat wall, so the wall stands in the gap.`,
      value: inner,
      limit: node.offset,
      fix: {
        label: `Set the gap to ${inner.toFixed(2)} mm`,
        ops: [{ t: 'update', id: node.id, patch: { offset: Number(inner.toFixed(2)) } }],
      },
    })
  if (legacy && clawReach > node.offset + 0.02)
    ctx.report({
      level: 'warning',
      code: 'halo.claws',
      message:
        'The centre stone’s claws cross the inner halo stones (the layout of halos made before claw clearance). Setting each claw in a notch between two halo stones keeps every stone clear; it recounts the stones.',
      fix: {
        label: 'Set the claws between the halo stones',
        ops: [{ t: 'update', id: node.id, patch: { clearClaws: true } }],
      },
    })

  // The metal ring under all rows, following the centre stone's outline.
  const width = node.rows * pitch - node.gap + 2 * (legacy ? LEGACY_BORDER : BORDER)
  const middle = inner + (node.rows * pitch - node.gap) / 2
  const depth = culet + FLOOR
  const middleFlat = shape.offsetPath(middle)
  const ringFlat = legacy ? middleFlat : bridgeClefts(shape, middleFlat, width)

  // On a band: lift the ring where it would sink into the band (a small centre stone sits low).
  let lift = 0
  const over = (x: number, y: number) => {
    if (!host) return null
    const [ox, oy] = host.over(x, y, POST_RADIUS + 0.1)
    return Math.hypot(ox - x, oy - y) < 1e-6 ? host.surfaceBelow(x, y) : null
  }
  const footprint =
    host && !legacy
      ? ringFlat.flatMap(([x, y]) => {
          const n = normalize([x - shape.centre[0], y - shape.centre[1], 0])
          return [-0.5, 0, 0.5].map((k): Vec2 => [x + n[0] * k * width, y + n[1] * k * width])
        })
      : []
  for (const [x, y] of footprint) {
    const surface = host!.surfaceBelow(x, y)
    if (surface !== null) lift = Math.max(lift, drop + depth - surface - MAX_SINK)
  }
  const girdleZ = -drop + lift
  // Metal surface a quarter of the crown above the small stones' girdles.
  const surfaceZ = girdleZ + 0.25 * crown
  if (lift > 0.05)
    ctx.report({
      level: 'info',
      code: 'halo.lifted',
      message: `The halo is raised ${lift.toFixed(2)} mm above its drop so it does not sink into the band under a small centre stone.`,
      value: lift,
    })

  // Claws along a side stand in notches of the row; round a claw on a point the row steps out,
  // unless stepping out would carry the sides with it: a princess's or trillion's straight sides
  // run from corner to corner, so stepping out round its V-claws pushed the whole row off the
  // girdle (a moat of 0.6–1 mm). Those claws stand in notches too, and the row hugs the sides.
  const small = stoneShape({
    cut: node.cut,
    stone: node.stone,
    dims,
    frame: centre.frame,
    role: 'accent',
    setting: 'pave',
  })
  // One per claw: building one slices the claw's surface.
  const built = new Map<ClawPlace, Obstacle>()
  const obstacle = (c: ClawPlace): Obstacle => {
    const own = claws.find((k) => k.phi === c.phi) ?? c
    let o = built.get(own)
    if (!o) built.set(own, (o = clawObstacle(shape, own, small, girdleZ)))
    return o
  }
  const innerPath = shape.offsetPath(inner + size / 2)
  const pushFor = (onPoint: readonly ClawPlace[]) =>
    pointPush(
      shape,
      innerPath,
      claws.map((c) => (onPoint.includes(c) ? c : { ...c, point: false })),
      obstacle,
    )
  const stepOut = legacy ? [] : claws.filter((c) => c.point)
  const allOut = pushFor(stepOut)
  const sides = sidePush(shape, claws, allOut)
  const onPoints = stepOut.filter((c) => sides(c) <= MAX_SIDE_PUSH)
  const notched = legacy ? [] : claws.filter((c) => !onPoints.includes(c))
  const obstacles = notched.map(obstacle)
  const push = onPoints.length === stepOut.length ? allOut : pushFor(onPoints)
  const pushed = (flat: readonly Vec2[]): Vec2[] =>
    onPoints.length === 0
      ? [...flat]
      : densify(flat, 0.1).map((q, i, all) => {
          const m = outwardAt(all, i)
          const k = push(q)
          return [q[0] + m[0] * k, q[1] + m[1] * k]
        })

  // The ring's inner edge stops short of the pavilion. The pavilion narrows downward, so its
  // silhouette at the ring's top (or the girdle itself, if the top is level with it) is what the
  // inner edge clears. A stone in a cleft's V has the pavilion on three sides: it sits there only
  // where the ring can still give it its seat wall.
  const silhouette = shape
    .polygon(8)
    .phis.map((phi) => shape.silhouette(phi, Math.min(surfaceZ, shape.girdleBottom)))
  const seatable = (p: Vec2) =>
    polygonDistance(silhouette, p) - PAVILION_CLEARANCE >= size / 2 + RULES.channelWall + 0.02
  const stones: Stone[] = []
  const cuts: Cut[] = []
  const additions: Addition[] = []
  const bead = RULES.beadDiameter(size)
  for (let row = 0; row < node.rows; row++) {
    const offset = inner + size / 2 + row * pitch
    const flat = legacy ? shape.offsetPath(offset) : pushed(shape.offsetPath(offset))
    const path = flat.map(([x, y]) => shape.toWorld([x, y, girdleZ]))
    const centres = legacy
      ? legacyCentres(shape, path, size, pitch)
      : rowCentres(shape, flat, path, size, node.gap, obstacles, seatable)
    const count = centres.length
    if (count < 3)
      throw new Error('the stones are too large to form a ring around the centre stone')
    centres.forEach((origin, i) => {
      const next = centres[(i + 1) % count]!
      const x = normalize(sub(next, centres[(i + count - 1) % count]!))
      const stone: Stone = {
        cut: node.cut,
        stone: node.stone,
        dims,
        frame: { origin, x, y: cross(up, x), z: up },
        role: 'accent',
        setting: 'pave',
      }
      stones.push(stone)
      if (ctx.detail !== 'production') return
      // Seats cut every metal they meet: the halo's ring, its posts and the band. In the old
      // layout the centre's claws cross the stones and must not be notched by them.
      const targets = legacy ? [node.id] : 'all'
      cuts.push({ solid: seatCutter(stone, { open: crown + 0.3 }), targets })
      cuts.push({ solid: seatHole(stone, size * RULES.seatHole, FLOOR + 0.3), targets })
      // Two beads in each gap, one either side of the row, each catching both girdles. Across
      // the open gap at a cleft the stones are too far apart for a bead to catch both.
      const halfGap = distance(origin, next) / 2
      if (halfGap > size / 2 + bead) return
      const mid = scale(add(origin, next), 0.5)
      const along = normalize(sub(next, origin))
      const across = cross(up, along)
      const reach = size / 2 + bead / 2 - 0.05
      const lateral = Math.sqrt(Math.max(0.01, reach * reach - halfGap * halfGap))
      for (const side of [-1, 1]) {
        const foot = addScaled(addScaled(mid, across, side * lateral), up, surfaceZ - girdleZ - 0.1)
        additions.push({ solid: pinSolid(foot, up, bead / 2, 0.1 + bead * 0.2), target: node.id })
      }
    })
  }

  // Where the rows step out round a claw the ring's outside follows them, so it needs stations
  // close enough to carry the bulge.
  const stations = onPoints.length ? densify(ringFlat, 0.15) : ringFlat
  const poly = stations.map(([x, y]) => shape.toWorld([x, y, 0]))
  const frames = pathFrames(poly, { closed: true, up })
  const thickness = surfaceZ - (girdleZ - depth)
  const corner = Math.min(0.12, thickness * 0.2)
  const zMid = (surfaceZ + girdleZ - depth) / 2
  // How far each section reaches inward from the ring's path. The inner row needs its seat
  // wall inside it, which takes the ring under the centre's girdle; it stops short of the
  // pavilion where it would meet it (`silhouette`, above).
  const sections = frames.map((f, i) => {
    const q = stations[i]!
    // Across a cleft's bridge the stones round the cleft still follow the unbridged row, which
    // dips inside the bridge (one may sit in the V itself), so there the ring fills the V up to
    // the centre's pavilion, as a setter fills it, to keep their seat walls.
    // There the nearest point of the pavilion is a lobe beside the section, not the V ahead of
    // it, so the reach is measured along the section.
    const bridged = !legacy && polygonDistance(middleFlat, q) > 0.01
    const ahead = bridged
      ? rayToPolygon(silhouette, q, scale2(outwardAt(stations, i), -1))
      : polygonDistance(silhouette, q)
    const inside = legacy
      ? width / 2
      : clamp(ahead - PAVILION_CLEARANCE, corner + 0.05, bridged ? width + size : width / 2)
    const outside = width / 2 + push(q)
    // Loop x points outward from the stone (the path runs counter-clockwise, x = tangent × up).
    const loop = roundedRectLoop(inside + outside, thickness, corner)
    return placeLoop(f, translateLoop(loop, (outside - inside) / 2, zMid))
  })
  const solids: Solid[] = [sweepSolid({ closed: true, sections })]

  // A ring that hangs above the band stands on posts (not on an old piece, which builds as it
  // did): one each side of the head, where the
  // ring crosses the band, and two where the band is wide enough for them to stand apart.
  if (host && !legacy) {
    const bottom = -(girdleZ - depth)
    const sites: { x: number; y: number; surface: number }[] = []
    ringFlat.forEach(([x, y]) => {
      const surface = over(x, y)
      if (surface !== null) sites.push({ x, y, surface })
    })
    const touches = sites.some((p) => p.surface <= bottom + 1e-3)
    if (sites.length && !touches)
      for (const sx of [-1, 1]) {
        const side = sites.filter((p) => Math.sign(p.x - shape.centre[0]) === sx)
        if (!side.length) continue
        const far = side.reduce((a, b) => (b.y > a.y ? b : a))
        const near = side.reduce((a, b) => (b.y < a.y ? b : a))
        const apart = Math.abs(far.y - near.y) > 4 * POST_RADIUS + 0.4
        const posts = apart
          ? [far, near]
          : [side.reduce((a, b) => (Math.abs(b.y) < Math.abs(a.y) ? b : a))]
        for (const p of posts) {
          // From inside the band up to the middle of the ring's thickness.
          const base = shape.toWorld([p.x, p.y, -(p.surface + POST_SINK)])
          const length = p.surface + POST_SINK - bottom + thickness / 2 - POST_RADIUS
          solids.push(pinSolid(base, up, POST_RADIUS, Math.max(0.1, length)))
        }
      }
  }
  return { bodies: solids.map((solid) => ({ solid, ...metalOf(node) })), stones, cuts, additions }
})
