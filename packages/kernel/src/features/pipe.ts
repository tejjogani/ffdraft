/** Wire swept along a drawn polyline or a smooth curve through inline points. */
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
import {
  add,
  addScaled,
  cross,
  dot,
  type Frame,
  length,
  normalize,
  scale,
  sub,
  type Vec3,
} from '../geometry/vec'

/** Stations per span between two path points: enough for the sweep to follow a tight bend. */
const PER_SPAN = 6
const RAIL_TOLERANCE = 1e-6
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

/** Whether the x axes used for a half-round dome face towards the middle of the curve. */
function facesInward(frames: readonly Frame[], points: readonly Vec3[]): boolean {
  const centre = scale(
    points.reduce<Vec3>((sum, p) => add(sum, p), [0, 0, 0]),
    1 / points.length,
  )
  return frames.reduce((sum, f) => sum + dot(f.x, sub(f.origin, centre)), 0) < 0
}

type Strip = readonly [Vec3, Vec3, Vec3, Vec3]

/** Separating axis test for the convex in-plane envelopes of non-neighbouring legs. */
function stripsOverlap(a: Strip, b: Strip, up: Vec3): boolean {
  const separated = (strip: Strip) =>
    strip.some((p, i) => {
      const axis = normalize(cross(up, sub(strip[(i + 1) % 4]!, p)))
      const ap = a.map((q) => dot(q, axis))
      const bp = b.map((q) => dot(q, axis))
      return (
        Math.max(...ap) + RAIL_TOLERANCE < Math.min(...bp) ||
        Math.max(...bp) + RAIL_TOLERANCE < Math.min(...ap)
      )
    })
  return !separated(a) && !separated(b)
}

function polylineWire(
  points: readonly Vec3[],
  closed: boolean,
  up: Vec3,
  section: Loop,
  thickness: number,
  taper: number,
  halfRound: boolean,
) {
  const count = points.length
  const legs = points.slice(0, closed ? count : count - 1).map((p, i) => {
    const delta = sub(points[(i + 1) % count]!, p)
    const span = length(delta)
    if (span <= RAIL_TOLERANCE)
      throw new Error('two consecutive rail points are too close together')
    return { delta, span, tangent: scale(delta, 1 / span) }
  })
  const frames = points.map((origin, i): Frame => {
    const previous = i > 0 ? legs[i - 1] : closed ? legs.at(-1) : undefined
    const incoming = (previous ?? legs[i])!.tangent
    const outgoing = legs[i]?.tangent ?? incoming
    const bisector = add(incoming, outgoing)
    const cosine = length(bisector) / 2
    if (cosine < 1e-6) throw new Error('the rail reverses direction at a wire corner')
    const z = scale(bisector, 0.5 / cosine)
    // The stretched bisector projects to the original section on either leg of the miter.
    return { origin, x: scale(cross(z, up), 1 / cosine), y: up, z }
  })
  if (halfRound && facesInward(frames, points))
    for (const f of frames) {
      f.x = scale(f.x, -1)
      f.y = scale(f.y, -1)
    }

  // The full-thickness strip bounds the entire leg, including when its section tapers.
  const radius = thickness / 2
  const side = (f: Frame, sign: number) => addScaled(f.origin, f.x, sign * radius)
  const strips = legs.map(({ tangent }, i): Strip => {
    const start = frames[i]!
    const end = frames[(i + 1) % count]!
    const strip: Strip = [side(start, -1), side(start, 1), side(end, 1), side(end, -1)]
    if (
      dot(sub(strip[2], strip[1]), tangent) <= RAIL_TOLERANCE ||
      dot(sub(strip[3], strip[0]), tangent) <= RAIL_TOLERANCE
    )
      throw new Error('the wire is too thick to miter this rail without folding a leg')
    return strip
  })
  for (let i = 0; i < strips.length; i++)
    for (let j = i + 2; j < strips.length; j++) {
      if (closed && i === 0 && j === strips.length - 1) continue
      if (stripsOverlap(strips[i]!, strips[j]!, up))
        throw new Error('the wire overlaps between non-neighbouring rail legs')
    }

  const kinks = points.map((_, i) => i)
  if (closed || taper === 0)
    return sweepSolid({ closed, kinks, sections: frames.map((f) => placeLoop(f, section)) })

  const distances = [0]
  for (const { span } of legs) distances.push(distances.at(-1)! + span)
  const total = distances.at(-1)!
  const fraction = distances.map((s) => (2 * s) / total - 1)
  const size = fraction.map((f) => 1 - taper * f ** 2)
  const sections = frames.map((f, i) => placeLoop(f, scaleLoop(section, size[i]!)))
  const bezierHandles = legs.map(({ delta, span }, i) => {
    const changeX = sub(frames[i + 1]!.x, frames[i]!.x)
    // The miter skew varies linearly along each leg and the taper is quadratic in rail distance.
    // Their product is cubic. Endpoint derivatives give the two exact Bézier handles.
    const handle = (index: number, step: number) => {
      const f = frames[index]!
      const k = size[index]!
      const dk = (-4 * taper * fraction[index]! * span) / total
      return placeLoop(
        {
          origin: addScaled(f.origin, delta, step),
          x: addScaled(scale(f.x, k + dk * step), changeX, k * step),
          y: scale(f.y, k + dk * step),
          z: f.z,
        },
        section,
      )
    }
    return [handle(i, 1 / 3), handle(i + 1, -1 / 3)] as const
  })
  return sweepSolid({ closed, kinks, sections, bezierHandles })
}

export const pipe = defineFeature('pipe', (node, ctx) => {
  const source = pipePath(node, node.curve === undefined ? undefined : ctx.input(node.curve).node)
  if (!source) throw new Error('the wire needs a construction curve or inline path points')
  const { points } = source

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

  if (source.plane) {
    const solid = polylineWire(
      points,
      source.closed,
      PLANE_NORMAL[source.plane],
      section,
      node.thickness,
      node.taper,
      node.section === 'halfRound',
    )
    return { bodies: [{ solid, ...metalOf(node) }] }
  }

  const distinct = points.filter((p, i) => i === 0 || length(sub(p, points[i - 1]!)) > 1e-6)
  if (distinct.length < 2) throw new Error('the path needs at least two different points')
  const closed = source.closed && distinct.length >= 3
  const path = smoothPath(distinct, closed, PER_SPAN)
  const plane = planeOf(distinct)
  const framesFor = (up: Vec3 | null) =>
    pathFrames(path.points, { closed, tangents: path.tangents, ...(up ? { up } : {}) })
  let frames = framesFor(plane)
  if (plane && node.section === 'halfRound' && facesInward(frames, distinct))
    frames = framesFor(scale(plane, -1))

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
