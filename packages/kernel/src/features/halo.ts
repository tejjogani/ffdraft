/**
 * Halo: rows of small stones on offsets of the centre stone's outline, seated in a metal ring.
 * Beads are raised between neighbouring stones at production detail.
 */
import { gemDims } from '@pave/schema'
import { type Addition, type Cut, defineFeature, metalOf, type Stone } from '../core'
import { seatCutter, seatHole } from '../gems/cutter'
import { type StoneShape, stoneShape } from '../gems/shape'
import { roundedRectLoop, translateLoop } from '../geometry/loop'
import { pathFrames, pathLength, resamplePath } from '../geometry/path'
import { pinSolid } from '../geometry/pin'
import { placeLoop, sweepSolid } from '../geometry/sweep'
import { add, addScaled, cross, distance, normalize, scale, sub, type Vec3 } from '../geometry/vec'
import { RULES } from '../rules'
import { culetDepth } from './gem'
import type { HeadData } from './setting'

/** Metal left beyond the outermost stones and under the culets, mm. */
const BORDER = 0.25
const FLOOR = 0.35

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

/**
 * Stone centres along a closed path that keep clear of the head's claws: each claw takes a
 * window of the path (its width plus a gap either side of a stone), and the stones are spread
 * evenly through the spans between windows. Claws are symmetric, so the halo stays symmetric.
 */
function centresBetween(
  path: readonly Vec3[],
  windows: readonly { s: number; half: number }[],
  pitch: number,
): Vec3[] {
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
  const sorted = windows.toSorted((a, b) => a.s - b.s)
  const out: Vec3[] = []
  sorted.forEach((w, k) => {
    const next = sorted[(k + 1) % sorted.length]!
    const start = w.s + w.half
    const end = next.s - next.half + (k + 1 === sorted.length ? total : 0)
    const span = end - start
    if (span < -1e-9) return
    const count = Math.floor(span / pitch + 1e-9) + 1
    for (let i = 0; i < count; i++)
      out.push(at(count === 1 ? (start + end) / 2 : start + (span * i) / (count - 1)))
  })
  return out
}

export const halo = defineFeature('halo', (node, ctx) => {
  const centre = ctx.input(node.around).stones[0]
  if (!centre) throw new Error('the stone it surrounds was not built')
  const shape = stoneShape(centre)
  const dims = gemDims(node.cut, node.stoneWidth)
  const size = Math.max(dims.width, dims.length)
  const pitch = size + node.gap
  const up = centre.frame.z
  const girdleZ = -node.drop
  const crown = dims.depth - culetDepth(node.cut, dims)
  // Metal surface a quarter of the crown above the small stones' girdles.
  const surfaceZ = girdleZ + 0.25 * crown

  // The head on the same stone: its claws or bezel reach past the girdle, so the inner row
  // keeps clear of them instead of running through them.
  const headData = node.head ? (ctx.tryInput(node.head)?.data as HeadData | undefined) : undefined
  const head = headData?.kind === 'head' ? headData : undefined
  // A bezel wall is a continuous rim: the halo starts beyond it.
  const inner = Math.max(node.offset, head?.wall ? head.wall + 0.05 : 0)

  const stones: Stone[] = []
  const cuts: Cut[] = []
  const additions: Addition[] = []
  const bead = RULES.beadDiameter(size)
  for (let row = 0; row < node.rows; row++) {
    const offset = inner + size / 2 + row * pitch
    const flat = shape.offsetPath(offset)
    const path = flat.map(([x, y]) => shape.toWorld([x, y, girdleZ]))
    // Claws that reach into this row's stones each take a window of the path.
    const claws = (head?.claws ?? []).filter((c) => c.reach > offset - size / 2 - 0.02)
    let count: number
    let centres: Vec3[]
    if (claws.length) {
      const lengths = [0]
      for (let i = 0; i < flat.length; i++) {
        const [ax, ay] = flat[i]!
        const [bx, by] = flat[(i + 1) % flat.length]!
        lengths.push(lengths[i]! + Math.hypot(bx - ax, by - ay))
      }
      const windows = claws.map((c) => {
        const g = shape.point(c.phi)
        let best = 0
        flat.forEach(([x, y], i) => {
          const [bx, by] = flat[best]!
          if (Math.hypot(x - g[0], y - g[1]) < Math.hypot(bx - g[0], by - g[1])) best = i
        })
        return { s: lengths[best]!, half: c.halfWidth + node.gap + size / 2 }
      })
      centres = centresBetween(path, windows, pitch)
      count = centres.length
    } else {
      count = symmetricCount(shape, pathLength(path, true) / pitch)
      centres = resamplePath(path, true, count)
    }
    // Spacing is measured along the path; where the path turns inward (a heart's cleft) stones
    // end up closer than that, so take stones out until none touch.
    const crowded = () =>
      centres.some((c, i) =>
        [1, 2, 3].some(
          (k) => count > 2 * k && distance(c, centres[(i + k) % count]!) < size + 0.02,
        ),
      )
    while (count >= 3 && crowded() && !claws.length) {
      count = symmetricCount(shape, count - 1)
      centres = resamplePath(path, true, count)
    }
    // Between claws, drop the stone nearest each crowded pair (the cleft) until none touch.
    while (claws.length && count >= 3 && crowded()) {
      const i = centres.findIndex((c, k) => distance(c, centres[(k + 1) % count]!) < size + 0.02)
      centres = centres.filter((_, k) => k !== (i + 1) % count)
      count = centres.length
    }
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
      // Seats cut every metal they meet: the halo's ring, and the band where a low halo dips
      // into it. The centre's claws stand in windows between the stones, so they are not
      // notched.
      cuts.push({ solid: seatCutter(stone, { open: crown + 0.3 }), targets: 'all' })
      cuts.push({ solid: seatHole(stone, size * RULES.seatHole, FLOOR + 0.3), targets: 'all' })
      // Two beads in each gap, one either side of the row, each catching both girdles.
      const mid = scale(add(origin, next), 0.5)
      const along = normalize(sub(next, origin))
      const across = cross(up, along)
      const reach = size / 2 + bead / 2 - 0.05
      const halfGap = distance(origin, next) / 2
      const lateral = Math.sqrt(Math.max(0.01, reach * reach - halfGap * halfGap))
      for (const side of [-1, 1]) {
        const foot = addScaled(addScaled(mid, across, side * lateral), up, surfaceZ - girdleZ - 0.1)
        additions.push({ solid: pinSolid(foot, up, bead / 2, 0.1 + bead * 0.2), target: node.id })
      }
    })
  }

  // One ring of metal under all rows, following the centre stone's outline.
  const width = node.rows * pitch - node.gap + 2 * BORDER
  const middle = inner + (node.rows * pitch - node.gap) / 2
  const depth = culetDepth(node.cut, dims) + FLOOR
  const poly = shape.offsetPath(middle).map(([x, y]) => shape.toWorld([x, y, 0]))
  const frames = pathFrames(poly, { closed: true, up })
  const thickness = surfaceZ - (girdleZ - depth)
  const profile = translateLoop(
    roundedRectLoop(width, thickness, Math.min(0.12, thickness * 0.2)),
    0,
    (surfaceZ + girdleZ - depth) / 2,
  )
  const ring = sweepSolid({
    closed: true,
    sections: frames.map((frame) => placeLoop(frame, profile)),
  })
  return { bodies: [{ solid: ring, ...metalOf(node) }], stones, cuts, additions }
})
