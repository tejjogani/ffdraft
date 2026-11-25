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
/** Closest neighbouring halo stones may be drawn together to keep the outline's symmetry, mm. */
const MIN_GAP = 0.05
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

/**
 * A claw as an obstacle for halo stones of `size`: its section at the girdle is a stadium
 * (round, tab, double and V-claws alike), `radius` out from its axis and `halfWidth` along the
 * girdle.
 */
function clawObstacle(shape: StoneShape, claw: ClawPlace, size: number): Obstacle {
  const g = shape.point(claw.phi)
  const n = shape.normal(claw.phi)
  const t: Vec2 = [-n[1], n[0]]
  const off = claw.reach - claw.radius
  const axis: Vec2 = [g[0] + n[0] * off, g[1] + n[1] * off]
  const straight = Math.max(0, claw.halfWidth - claw.radius)
  return ([x, y]) => {
    const u = (x - axis[0]) * n[0] + (y - axis[1]) * n[1]
    const v = (x - axis[0]) * t[0] + (y - axis[1]) * t[1]
    return (
      Math.hypot(u, Math.max(0, Math.abs(v) - straight)) - claw.radius - size / 2 - CLAW_CLEARANCE
    )
  }
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
): Vec3[] {
  const pitch = size + gap
  const { total, at } = arcs(path)
  const plan = arcs(flat.map(([x, y]): Vec3 => [x, y, 0]))
  const [, cy] = shape.centre
  const clefts = concaveCorners(shape).map((phi) => {
    const c = axisCrossing(shape, flat, shape.point(phi)[1] > cy ? 1 : -1)
    // Smallest half-window whose two ends are a stone and its gap apart.
    let half = pitch / 2
    while (half < total / 4 && distance(at(c - half), at(c + half)) < pitch) half += 0.01
    return { c, half }
  })
  const blocked = (s: number): boolean =>
    clefts.some(({ c, half }) => Math.abs(around(s, c, total)) < half) ||
    obstacles.some((o) => {
      const [x, y] = plan.at(s)
      return o([x, y]) < 0
    })
  const samples = Math.max(64, Math.ceil(total / 0.02))
  const ds = total / samples
  const free = Array.from({ length: samples }, (_, i) => !blocked(i * ds))
  const first = free.indexOf(false)
  if (first < 0) {
    // Start on the length axis at its larger-y end (a pear's point, a marquise's tip).
    const start = axisCrossing(shape, flat, 1)
    return evenLayout(shape, total, size, gap, (count) =>
      Array.from({ length: count }, (_, i) => at(start + (total * i) / count)),
    )
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
  const centres: Vec3[] = []
  const widest = size + Math.max(gap, MAX_GAP)
  for (let i = first; i < first + samples; i++) {
    if (!free[i % samples]) continue
    let j = i
    while (j + 1 < first + samples && free[(j + 1) % samples]) j++
    const a = edge((i - 1) * ds, i * ds)
    const b = edge((j + 1) * ds, j * ds)
    const span = Math.max(0, b - a)
    // As many stones as fit at the asked gap, spread up to `MAX_GAP` with any slack beside the
    // claws; or one more, drawn closer (never under `MIN_GAP`), when that is nearer the asked
    // gap than the spread and the slack together.
    const fit = Math.floor(span / pitch + 1e-9) + 1
    const off = (count: number) => {
      if (count < 2) return { count, step: 0, cost: span / 2 }
      const step = Math.min(span / (count - 1), widest)
      // Measured in space: round a curve stones stand closer than along the path.
      const lead = (span - step * (count - 1)) / 2
      const apart = Array.from({ length: count - 1 }, (_, k) =>
        distance(at(a + lead + step * k), at(a + lead + step * (k + 1))),
      ).every((d) => d >= size + MIN_GAP)
      if (count > fit && !apart) return { count, step, cost: Infinity }
      return { count, step, cost: Math.abs(step - size - gap) + lead }
    }
    const best = [off(fit), off(fit + 1)].reduce((x, y) => (y.cost < x.cost ? y : x))
    const { count, step } = best
    const lead = (span - step * (count - 1)) / 2
    for (let k = 0; k < count; k++) centres.push(at(a + lead + step * k))
    i = j
  }
  return centres
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
  const inner = legacy || wall === 0 ? node.offset : Math.max(node.offset, wall + 0.05)
  if (inner > node.offset + 1e-6)
    ctx.report({
      level: 'info',
      code: 'halo.offset',
      message: `The halo starts ${inner.toFixed(2)} mm from the centre stone, just beyond its ${wall.toFixed(2)} mm bezel wall, not at the ${node.offset.toFixed(2)} mm gap asked.`,
      value: inner,
      limit: node.offset,
      fix: {
        label: `Set the gap to ${inner.toFixed(2)} mm`,
        ops: [{ t: 'update', id: node.id, patch: { offset: Number(inner.toFixed(2)) } }],
      },
    })
  // Claws along a side stand in notches of the row; round a claw on a point the row steps out.
  const notched = legacy ? [] : claws.filter((c) => !c.point)
  const onPoints = legacy ? [] : claws.filter((c) => c.point)
  const obstacles = notched.map((c) => clawObstacle(shape, c, size))
  const push = pointPush(shape, shape.offsetPath(inner + size / 2), legacy ? [] : claws, (c) =>
    clawObstacle(shape, c, size),
  )
  const pushed = (flat: readonly Vec2[]): Vec2[] =>
    onPoints.length === 0
      ? [...flat]
      : densify(flat, 0.1).map((q, i, all) => {
          const m = outwardAt(all, i)
          const k = push(q)
          return [q[0] + m[0] * k, q[1] + m[1] * k]
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
  const ringFlat = legacy
    ? shape.offsetPath(middle)
    : bridgeClefts(shape, shape.offsetPath(middle), width)

  // The inner row's seat wall runs in under the centre's girdle, so the ring's top must be low
  // enough that the pavilion has narrowed by that wall (and air) there. A thick girdle (a large
  // stone) takes the halo lower than its drop asks.
  let drop = node.drop
  const wallIn = RULES.channelWall + 0.02 + PAVILION_CLEARANCE - inner
  if (!legacy && wallIn > 0) {
    const girdle = shape.polygon(8)
    const inset = (z: number) =>
      Math.min(
        ...girdle.phis.map((phi) => polygonDistance(girdle.points, shape.silhouette(phi, z))),
      )
    let top = shape.girdleBottom
    while (top > shape.culet / 2 && inset(top) < wallIn) top -= 0.02
    drop = Math.max(drop, 0.25 * crown - top)
  }
  if (drop > node.drop + 0.05)
    ctx.report({
      level: 'info',
      code: 'halo.lowered',
      message: `The halo sits ${drop.toFixed(2)} mm below the girdle, not ${node.drop.toFixed(2)} mm: the inner stones need their seat wall under the centre stone’s girdle, and it is thick.`,
      value: drop,
      limit: node.drop,
    })

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
      : rowCentres(shape, flat, path, size, node.gap, obstacles)
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
  // pavilion where it would meet it. The pavilion narrows downward, so its silhouette at the
  // ring's top (or the girdle itself, if the top is level with it) is what the inner edge clears.
  const silhouette = shape
    .polygon(8)
    .phis.map((phi) => shape.silhouette(phi, Math.min(surfaceZ, shape.girdleBottom)))
  const sections = frames.map((f, i) => {
    const q = stations[i]!
    const inside = legacy
      ? width / 2
      : clamp(polygonDistance(silhouette, q) - PAVILION_CLEARANCE, corner + 0.05, width / 2)
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
