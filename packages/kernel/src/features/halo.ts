/**
 * Halo: rows of small stones on offsets of the centre stone's outline, seated in a metal ring.
 * Beads are raised between neighbouring stones at production detail.
 *
 * The centre's claws stand inside the halo: the inner row starts beyond their outside, so every
 * stone keeps the halo's spacing all the way round and no claw crosses a stone. (Pieces from
 * before this keep their old layout through `clearClaws: false`.) On a band the ring is lifted
 * off it where it would sink in, and stands on posts where it hangs above it, so it casts as
 * one piece with the band whatever alloy the head is.
 */
import { gemDims } from '@pave/schema'
import { type Addition, type Cut, defineFeature, metalOf, type Solid, type Stone } from '../core'
import { seatCutter, seatHole } from '../gems/cutter'
import { type StoneShape, stoneShape } from '../gems/shape'
import { roundedRectLoop, translateLoop } from '../geometry/loop'
import { pathFrames, pathLength, resamplePath } from '../geometry/path'
import { pinSolid } from '../geometry/pin'
import { placeLoop, sweepSolid } from '../geometry/sweep'
import {
  add,
  addScaled,
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
import type { HeadData } from './setting'

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
 * How many stones go round, respecting the outline's symmetry: a square halo wants a multiple
 * of four so every corner looks the same, an oval a multiple of two.
 */
function symmetricCount(shape: StoneShape, fit: number): number {
  const outline = shape.unit.outline
  const square = Math.abs(outline.length - 1) < 1e-6 && Math.abs(outline.centre[1]) < 1e-9
  const twoFold = Math.abs(outline.centre[1]) < 1e-9
  const step = shape.stone.cut === 'round' ? 1 : square ? 4 : twoFold ? 2 : 1
  return Math.floor(fit / step) * step
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

/** Concave corners of the outline (a heart's cleft), as directions from the centre. */
function concaveCorners(shape: StoneShape): number[] {
  return shape.unit.outline.corners.filter((phi) => {
    const h = 1e-3
    const [a, b, c] = [phi - h, phi, phi + h].map((x) => shape.point(x)) as [Vec2, Vec2, Vec2]
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < 0
  })
}

/**
 * Stone centres round one row's path, mirror-symmetric about the stone's length axis.
 *
 * Without a cleft the stones are spread evenly from a point on the axis (so a pear or marquise
 * has a stone on each point). At a cleft the path is cut open: the two stones beside it are
 * set just far enough apart not to touch across it, and the rest spread evenly between them.
 */
function rowCentres(
  shape: StoneShape,
  flat: readonly Vec2[],
  path: readonly Vec3[],
  pitch: number,
): Vec3[] {
  const { total, at } = arcs(path)
  const [, cy] = shape.centre
  const clefts = concaveCorners(shape).map((phi) =>
    axisCrossing(shape, flat, shape.point(phi)[1] > cy ? 1 : -1),
  )
  if (clefts.length === 1) {
    const c = clefts[0]!
    // Smallest half-window whose two ends are a stone and its gap apart.
    let half = pitch / 2
    while (half < total / 4 && distance(at(c - half), at(c + half)) < pitch) half += 0.01
    const span = total - 2 * half
    const count = Math.floor(span / pitch + 1e-9) + 1
    return Array.from({ length: count }, (_, i) =>
      at(c + half + (count === 1 ? span / 2 : (span * i) / (count - 1))),
    )
  }
  const count = symmetricCount(shape, total / pitch)
  // Start on the length axis at its larger-y end (a pear's point, a marquise's tip).
  const start = axisCrossing(shape, flat, 1)
  return Array.from({ length: count }, (_, i) => at(start + (total * i) / count))
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
  let count = symmetricCount(shape, pathLength(path, true) / pitch)
  let centres = resamplePath(path, true, count)
  // Spacing is measured along the path; where the path turns inward (a heart's cleft) stones
  // end up closer than that, so take stones out until none touch.
  const crowded = () =>
    centres.some((c, i) =>
      [1, 2, 3].some((k) => count > 2 * k && distance(c, centres[(i + k) % count]!) < size + 0.02),
    )
  while (count >= 3 && crowded()) {
    count = symmetricCount(shape, count - 1)
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

  // The head on the same stone: its claws or bezel reach past the girdle, and the inner row
  // starts beyond them.
  const headData = node.head ? (ctx.tryInput(node.head)?.data as HeadData | undefined) : undefined
  const head = headData?.kind === 'head' ? headData : undefined
  const clawReach = Math.max(0, ...(head?.claws ?? []).map((c) => c.reach))
  const inner = legacy
    ? node.offset
    : Math.max(
        node.offset,
        head?.wall ? head.wall + 0.05 : 0,
        clawReach > 0 ? clawReach + node.gap : 0,
      )

  if (legacy && clawReach > node.offset + 0.02)
    ctx.report({
      level: 'warning',
      code: 'halo.claws',
      message:
        'The centre stone’s claws cross the inner halo stones (the layout of halos made before claw clearance). Starting the halo outside the claws keeps every stone clear; it recounts the stones.',
      fix: {
        label: 'Start the halo outside the claws',
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
    if (surface !== null) lift = Math.max(lift, node.drop + depth - surface - MAX_SINK)
  }
  const girdleZ = -node.drop + lift
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
    const flat = shape.offsetPath(offset)
    const path = flat.map(([x, y]) => shape.toWorld([x, y, girdleZ]))
    const centres = legacy
      ? legacyCentres(shape, path, size, pitch)
      : rowCentres(shape, flat, path, pitch)
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

  const poly = ringFlat.map(([x, y]) => shape.toWorld([x, y, 0]))
  const frames = pathFrames(poly, { closed: true, up })
  const thickness = surfaceZ - (girdleZ - depth)
  const profile = translateLoop(
    roundedRectLoop(width, thickness, Math.min(0.12, thickness * 0.2)),
    0,
    (surfaceZ + girdleZ - depth) / 2,
  )
  const solids: Solid[] = [
    sweepSolid({ closed: true, sections: frames.map((f) => placeLoop(f, profile)) }),
  ]

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
        const extremes = [
          side.reduce((a, b) => (b.y > a.y ? b : a)),
          side.reduce((a, b) => (b.y < a.y ? b : a)),
        ]
        const apart = Math.abs(extremes[0].y - extremes[1].y) > 4 * POST_RADIUS + 0.4
        const posts = apart
          ? extremes
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
