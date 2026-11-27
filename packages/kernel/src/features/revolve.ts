/** Lathe forms: an SVG profile in the (radius, height) half-plane turned about the Z axis. */
import { pointFromCurvePlane } from '@pave/schema'
import { assembleWire, type Edge, makeBezierCurve, makeFace, makeLine, revolution } from 'replicad'
import { defineFeature, metalOf, solidFromBrep } from '../core'
import { parsePathData, type SubPath } from '../geometry/svgPath'
import type { Vec2 } from '../geometry/vec'

/** Profile point → 3D: radius along X (never negative), height along Z. */
const lift = ([r, h]: Vec2): [number, number, number] => [Math.max(0, r), 0, h]

const same = (a: Vec2, b: Vec2): boolean =>
  Math.hypot(Math.max(0, a[0]) - Math.max(0, b[0]), a[1] - b[1]) < 1e-7

function profileEdges(path: SubPath): Edge[] {
  const edges: Edge[] = []
  for (const segment of path.segments) {
    const [first, last] = [segment.points[0], segment.points[segment.points.length - 1]!]
    if (same(first, last)) continue
    edges.push(
      segment.type === 'line'
        ? makeLine(lift(first), lift(last))
        : makeBezierCurve(segment.points.map(lift)),
    )
  }
  // An open profile is closed with a straight line (along the axis, typically).
  const start = path.segments[0]!.points[0]
  const lastSegment = path.segments[path.segments.length - 1]!
  const end = lastSegment.points[lastSegment.points.length - 1]!
  if (!same(start, end)) edges.push(makeLine(lift(end), lift(start)))
  return edges
}

/** The profile as a polygon in the half-plane it is turned in (Béziers sampled). */
function outline(path: SubPath): Vec2[] {
  const points: Vec2[] = []
  for (const segment of path.segments) {
    const [p0, p1, p2, p3] = segment.points
    if (segment.type === 'line') points.push([Math.max(0, p0[0]), p0[1]])
    else
      for (let i = 0; i < 8; i++) {
        const t = i / 8
        const u = 1 - t
        const at = (k: 0 | 1) =>
          u * u * u * p0[k] + 3 * u * u * t * p1![k] + 3 * u * t * t * p2![k] + t * t * t * p3![k]
        points.push([Math.max(0, at(0)), at(1)])
      }
  }
  return points
}

const cross = (o: Vec2, a: Vec2, b: Vec2) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/**
 * Rejects profiles OpenCascade would turn into an open or self-intersecting surface without
 * complaint, with a reason the designer can act on.
 */
function checkProfile(path: SubPath): void {
  const ring = outline(path)
  // Crossings first: the two lobes of a bow-tie cancel, so it would read as "no area".
  const n = ring.length
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      const [a, b, c, d] = [ring[i]!, ring[(i + 1) % n]!, ring[j]!, ring[(j + 1) % n]!]
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
        throw new Error('the profile crosses itself; reorder its points so the outline does not')
    }
  let area = 0
  ring.forEach((p, i) => {
    area += cross([0, 0], p, ring[(i + 1) % ring.length]!)
  })
  const size = Math.max(...ring.flat().map(Math.abs), 1)
  if (Math.abs(area) / 2 < 1e-6 * size * size)
    throw new Error('the profile encloses no area (its points lie on one line, or on the axis)')
}

export const revolve = defineFeature('revolve', (node, ctx) => {
  type Point = [number, number, number]
  const turn = (edges: Edge[], origin: Point, direction: Point) => {
    const wire = ctx.track(assembleWire(edges))
    const face = ctx.track(makeFace(wire))
    return {
      solid: solidFromBrep(revolution(face, origin, direction, node.angle)),
      ...metalOf(node),
    }
  }
  if (node.curve !== undefined) {
    const source = ctx.input(node.curve).node
    if (source.kind !== 'curve') throw new Error('Revolve needs a construction curve.')
    const points = source.points.map(({ u, v }) =>
      pointFromCurvePlane(source.plane, [u, v], source.planeOffset),
    )
    const edges = points.map((p, i) => ctx.track(makeLine(p, points[(i + 1) % points.length]!)))
    const vertical = node.axis !== 'horizontal'
    const offset = node.axisOffset ?? 0
    const origin = pointFromCurvePlane(
      source.plane,
      vertical ? [offset, 0] : [0, offset],
      source.planeOffset,
    )
    const direction = pointFromCurvePlane(source.plane, vertical ? [0, 1] : [1, 0])
    return { bodies: [turn(edges, origin, direction)] }
  }
  const paths = parsePathData(node.profile ?? '')
  if (!paths.length) throw new Error('the profile is empty')
  return {
    bodies: paths.map((path) => {
      checkProfile(path)
      const edges = profileEdges(path).map((e) => ctx.track(e))
      if (edges.length < 2)
        throw new Error('the profile needs at least two segments to enclose an area')
      return turn(edges, [0, 0, 0], [0, 0, 1])
    }),
  }
})
