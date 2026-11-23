/**
 * The loop a pendant hangs from. It places itself on the top centre of its host and is turned
 * so that a chain passes through along X.
 */
import type { NodeOf } from '@pave/schema'
import { type Solid, defineFeature, metalOf } from '../core'
import { type Loop, circleLoop, roundedRectLoop } from '../geometry/loop'
import { pathFrames } from '../geometry/path'
import { placeLoop, sweepSolid } from '../geometry/sweep'
import type { Frame, Vec3 } from '../geometry/vec'
import { unionBounds } from '../solid/meshing'

type BailNode = NodeOf<'bail'>

/** How far the bail's foot is sunk into its host so the two cast as one, mm. */
const SINK = 0.3

/** Band of the given section carried round a path in the YZ plane; `x` is the band's width axis. */
function band(path: Vec3[], closed: boolean, section: (i: number) => Loop): Solid {
  const frames = pathFrames(path, { closed, up: [1, 0, 0] })
  return sweepSolid({ closed, sections: frames.map((frame, i) => placeLoop(frame, section(i))) })
}

/** Points on a circle in the YZ plane. */
const circle = (centre: Vec3, radius: number, count: number): Vec3[] =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * 2 * Math.PI
    return [centre[0], centre[1] + radius * Math.sin(a), centre[2] - radius * Math.cos(a)]
  })

function build(node: BailNode, top: Vec3, back: number): { solid: Solid; opening: Vec3 } {
  const { opening, width, wire } = node
  const [x, y, z] = top
  // Section drawn as (through the wire, along X).
  const flat = (w: number) => roundedRectLoop(wire, w, Math.min(wire, w) * 0.3)
  switch (node.style) {
    case 'ring': {
      const centre: Vec3 = [x, y, z - SINK + (opening + wire) / 2 - wire / 2]
      return { solid: band(circle(centre, (opening + wire) / 2, 32), true, () => circleLoop(wire / 2)), opening: centre }
    }
    case 'tube': {
      const centre: Vec3 = [x, y, z - SINK + (opening + wire) / 2 - wire / 2]
      return { solid: band(circle(centre, (opening + wire) / 2, 32), true, () => flat(width)), opening: centre }
    }
    case 'hidden': {
      // A flat loop standing off the back of the piece, just below its top edge.
      const depth = Math.max(opening * 0.45, 1.2) + wire
      const height = opening + wire
      const zc = z - wire - height / 2
      const r = Math.min(depth, height) * 0.35
      const corners: [number, number][] = [[-wire, -height / 2], [depth, -height / 2], [depth, height / 2], [-wire, height / 2]]
      // Open path: both ends are buried in the host's back.
      const path: Vec3[] = [[x, back + corners[0]![0], zc + corners[0]![1]]]
      for (const [k, [cy, cz]] of [corners[1]!, corners[2]!].entries()) {
        for (let i = 0; i <= 6; i++) {
          const a = (k === 0 ? -Math.PI / 2 : 0) + (i / 6) * (Math.PI / 2)
          path.push([x, back + cy - r + r * Math.cos(a), zc + cz + (k === 0 ? r : -r) + r * Math.sin(a)])
        }
      }
      path.push([x, back + corners[3]![0], zc + corners[3]![1]])
      return { solid: band(path, false, () => flat(width)), opening: [x, back + depth / 2 - wire / 2, zc] }
    }
    default: {
      // A teardrop: narrow where it joins the piece, opening out above. Both ends are sunk in.
      const h = opening + wire
      const w = Math.max(opening * 0.62, wire * 2.2)
      const count = 28
      const path: Vec3[] = Array.from({ length: count + 1 }, (_, i) => {
        const t = (i / count) * 2 * Math.PI
        const spread = Math.sin(t / 2) ** 0.7
        return [x, y + (w / 2) * Math.sin(t) * spread + 0.18 * wire * Math.cos(t / 2), z - SINK + (h / 2) * (1 - Math.cos(t))]
      })
      // The band is narrower at its foot and full width over the top.
      const section = (i: number) => flat(width * (0.55 + 0.45 * Math.sin((i / count) * Math.PI)))
      return { solid: band(path, false, section), opening: [x, y, z - SINK + h * 0.6] }
    }
  }
}

export const bail = defineFeature('bail', (node, ctx) => {
  const host = node.host ? ctx.input(node.host) : null
  const bounds = host && host.bodies.length > 0 ? unionBounds(host.bodies.map((b) => b.solid.bounds())) : null
  const top: Vec3 = bounds
    ? [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, bounds.max[2]]
    : [0, 0, 0]
  const { solid, opening } = build(node, top, bounds ? bounds.max[1] : 0)
  if (node.opening < node.wire * 1.2)
    ctx.report({
      level: 'info',
      code: 'bail.tight',
      message: 'The bail opening is barely larger than its wire; check that the chain end passes through.',
    })
  // A chain threads the opening along x.
  const frame: Frame = { origin: opening, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
  return { bodies: [{ solid, ...metalOf(node) }], frames: { opening: frame } }
})
