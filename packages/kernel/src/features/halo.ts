/**
 * Halo: rows of small stones on offsets of the centre stone's outline, seated in a metal ring.
 * Beads are raised between neighbouring stones at production detail.
 */
import { gemDims } from '@pave/schema'
import { type Addition, type Cut, type Stone, defineFeature, metalOf } from '../core'
import { seatCutter, seatHole } from '../gems/cutter'
import { type StoneShape, stoneShape } from '../gems/shape'
import { roundedRectLoop, translateLoop } from '../geometry/loop'
import { pathFrames, pathLength, resamplePath } from '../geometry/path'
import { pinSolid } from '../geometry/pin'
import { placeLoop, sweepSolid } from '../geometry/sweep'
import { add, addScaled, cross, distance, normalize, scale, sub } from '../geometry/vec'
import { RULES } from '../rules'
import { culetDepth } from './gem'

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

  const stones: Stone[] = []
  const cuts: Cut[] = []
  const additions: Addition[] = []
  const bead = RULES.beadDiameter(size)
  for (let row = 0; row < node.rows; row++) {
    const offset = node.offset + size / 2 + row * pitch
    const path = shape.offsetPath(offset).map(([x, y]) => shape.toWorld([x, y, girdleZ]))
    const count = symmetricCount(shape, pathLength(path, true) / pitch)
    if (count < 3) throw new Error('the stones are too large to form a ring around the centre stone')
    const centres = resamplePath(path, true, count)
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
      // Seats are cut into the halo's own ring only: the centre stone's claws pass through the
      // halo and must not be notched by its stones.
      cuts.push({ solid: seatCutter(stone, { open: crown + 0.3 }), targets: [node.id] })
      cuts.push({ solid: seatHole(stone, size * RULES.seatHole, FLOOR + 0.3), targets: [node.id] })
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
  const middle = node.offset + (node.rows * pitch - node.gap) / 2
  const depth = culetDepth(node.cut, dims) + FLOOR
  const poly = shape.offsetPath(middle).map(([x, y]) => shape.toWorld([x, y, 0]))
  const frames = pathFrames(poly, { closed: true, up })
  const thickness = surfaceZ - (girdleZ - depth)
  const profile = translateLoop(
    roundedRectLoop(width, thickness, Math.min(0.12, thickness * 0.2)),
    0,
    (surfaceZ + girdleZ - depth) / 2,
  )
  const ring = sweepSolid({ closed: true, sections: frames.map((frame) => placeLoop(frame, profile)) })
  return { bodies: [{ solid: ring, ...metalOf(node) }], stones, cuts, additions }
})
