/** Lathe forms: an SVG profile in the (radius, height) half-plane turned about the Z axis. */
import { type Edge, assembleWire, makeBezierCurve, makeFace, makeLine, revolution } from 'replicad'
import { defineFeature, metalOf, solidFromBrep } from '../core'
import { type SubPath, parsePathData } from '../geometry/svgPath'
import type { Vec2 } from '../geometry/vec'

/** Profile point → 3D: radius along X (never negative), height along Z. */
const lift = ([r, h]: Vec2): [number, number, number] => [Math.max(0, r), 0, h]

const same = (a: Vec2, b: Vec2): boolean => Math.hypot(Math.max(0, a[0]) - Math.max(0, b[0]), a[1] - b[1]) < 1e-7

function profileEdges(path: SubPath): Edge[] {
  const edges: Edge[] = []
  for (const segment of path.segments) {
    const [first, last] = [segment.points[0], segment.points[segment.points.length - 1]!]
    if (same(first, last)) continue
    edges.push(segment.type === 'line' ? makeLine(lift(first), lift(last)) : makeBezierCurve(segment.points.map(lift)))
  }
  // An open profile is closed with a straight line (along the axis, typically).
  const start = path.segments[0]!.points[0]
  const lastSegment = path.segments[path.segments.length - 1]!
  const end = lastSegment.points[lastSegment.points.length - 1]!
  if (!same(start, end)) edges.push(makeLine(lift(end), lift(start)))
  return edges
}

export const revolve = defineFeature('revolve', (node, ctx) => {
  const paths = parsePathData(node.profile)
  if (paths.length === 0) throw new Error('the profile is empty')
  const bodies = paths.map((path) => {
    const edges = profileEdges(path).map((e) => ctx.track(e))
    if (edges.length < 2) throw new Error('the profile needs at least two segments to enclose an area')
    const wire = ctx.track(assembleWire(edges))
    const face = ctx.track(makeFace(wire))
    return { solid: solidFromBrep(revolution(face, [0, 0, 0], [0, 0, 1], node.angle)), ...metalOf(node) }
  })
  return { bodies }
})
