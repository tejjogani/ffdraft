/** Wire swept along a smooth curve through the given points: vines, hoops, bangles, bypass bands. */
import { type CurvePlane, pipePath } from '@pave/schema'
import { defineFeature, metalOf } from '../core'
import {
  ellipseLoop,
  halfRoundLoop,
  type Loop,
  rotateLoop,
  roundedRectLoop,
  scaleLoop,
  translateLoop,
} from '../geometry/loop'
import { pathFrames, smoothPath } from '../geometry/path'
import { placeLoop, poleSection, sweepSolid } from '../geometry/sweep'
import { add, dot, length, normalize, scale, sub, type Vec3 } from '../geometry/vec'

/** Stations per span between two path points: enough for the sweep to follow a tight bend. */
const PER_SPAN = 6
const PLANE_NORMAL: Record<CurvePlane, Vec3> = {
  front: [0, -1, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
}

/** Unit normal of the plane a path lies in, or null when it is straight or clearly not planar. */
function planeOf(points: readonly Vec3[]): Vec3 | null {
  // Newell's method: the area vector of the polygon through the points.
  let n: Vec3 = [0, 0, 0]
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!
    n = [
      n[0] + (p[1] - q[1]) * (p[2] + q[2]),
      n[1] + (p[2] - q[2]) * (p[0] + q[0]),
      n[2] + (p[0] - q[0]) * (p[1] + q[1]),
    ]
  })
  if (length(n) < 1e-6) return null
  const unit = normalize(n)
  const off = Math.max(...points.map((p) => Math.abs(dot(sub(p, points[0]!), unit))))
  const size = Math.max(...points.map((p) => length(sub(p, points[0]!))))
  return off < 0.02 * size ? unit : null
}

export const pipe = defineFeature('pipe', (node, ctx) => {
  const source = pipePath(node, node.curve === undefined ? undefined : ctx.input(node.curve).node)
  if (!source) throw new Error('the wire needs a construction curve or inline path points')
  const { points } = source
  const distinct = points.filter((p, i) => i === 0 || length(sub(p, points[i - 1]!)) > 1e-6)
  if (distinct.length < 2) throw new Error('the path needs at least two different points')
  const closed = source.closed && distinct.length >= 3
  const path = smoothPath(distinct, closed, PER_SPAN)

  // Section axes: x is "thickness" and y "width". In a planar path y follows the plane's normal,
  // so a bangle or hoop gets its width along its axis, like a ring band.
  const section: Loop =
    node.section === 'round'
      ? ellipseLoop(node.thickness / 2, node.width / 2)
      : node.section === 'square'
        ? roundedRectLoop(node.thickness, node.width, Math.min(node.width, node.thickness) * 0.08)
        : // Centred like the others, then turned so the dome faces along x.
          rotateLoop(
            translateLoop(halfRoundLoop(node.width, node.thickness), 0, -node.thickness / 2),
            -Math.PI / 2,
          )

  // A straight drawn curve still has a plane, so its width follows the correct drawing axis.
  const plane = source.plane ? PLANE_NORMAL[source.plane] : planeOf(distinct)
  const framesFor = (up: Vec3 | null) =>
    pathFrames(path.points, { closed, tangents: path.tangents, ...(up ? { up } : {}) })
  let frames = framesFor(plane)
  if (plane && node.section === 'halfRound') {
    // A half-round domes away from the middle of the curve, flat side in.
    const centre = scale(
      distinct.reduce<Vec3>((sum, p) => add(sum, p), [0, 0, 0]),
      1 / distinct.length,
    )
    const outward = frames.reduce((sum, f) => sum + dot(f.x, sub(f.origin, centre)), 0)
    if (outward < 0) frames = framesFor(scale(plane, -1))
  }

  const last = frames.length - 1
  const taper = closed ? 0 : node.taper
  const sections = frames.map((frame, i) => {
    // Thinning toward both ends, fastest at the very tip.
    const k = 1 - taper * Math.abs((2 * i) / last - 1) ** 2
    return k < 0.03
      ? poleSection(frame.origin, section.length)
      : placeLoop(frame, scaleLoop(section, k))
  })
  return { bodies: [{ solid: sweepSolid({ closed, sections }), ...metalOf(node) }] }
})
