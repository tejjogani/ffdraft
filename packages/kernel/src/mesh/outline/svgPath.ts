/**
 * SVG path data → closed polygons, for outlines that become meshes. The grammar is the core's
 * (`geometry/svgPath.ts`, exact lines and cubics); this only flattens its curves to within
 * `tolerance` (path units) and closes every subpath, as SVG fills them. Coordinates are
 * returned as written (SVG's y axis points down; callers flip as needed).
 */
import { type PathSegment, parsePathData } from '../../geometry/svgPath'

export type Point = [number, number]
export type Contour = Point[]

/** Upper bound on the pieces one cubic is cut into, whatever its size. */
const MAX_PIECES = 256

/** Parses and flattens path data into closed contours (degenerate ones are dropped). */
export function parseSvgPath(d: string, tolerance: number): Contour[] {
  const contours: Contour[] = []
  for (const path of parsePathData(d)) {
    const contour: Contour = []
    for (const segment of path.segments) flattenSegment(segment, tolerance, contour)
    // The closing point repeats the first; polygons are implicitly closed.
    const [first, last] = [contour[0], contour[contour.length - 1]]
    if (first && last && contour.length > 1 && first[0] === last[0] && first[1] === last[1])
      contour.pop()
    if (contour.length >= 3) contours.push(contour)
  }
  return contours
}

/** Appends the segment's points (its start only when the contour is empty). */
function flattenSegment(segment: PathSegment, tolerance: number, out: Contour): void {
  const [p0] = segment.points
  if (out.length === 0) out.push([p0[0], p0[1]])
  if (segment.type === 'line') {
    out.push([segment.points[1][0], segment.points[1][1]])
    return
  }
  const [, p1, p2, p3] = segment.points
  // The curve stays within ¾ of its control polygon's deviation from the chord, and the
  // deviation of n uniform pieces falls as 1/n² (the bound behind the classic flattening rule).
  const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1])
  const offChord = (c: readonly [number, number]) =>
    chord > 0
      ? Math.abs((c[0] - p0[0]) * (p3[1] - p0[1]) - (c[1] - p0[1]) * (p3[0] - p0[0])) / chord
      : Math.hypot(c[0] - p0[0], c[1] - p0[1])
  const sag = Math.max(offChord(p1), offChord(p2))
  const pieces = Math.min(MAX_PIECES, Math.max(1, Math.ceil(Math.sqrt((0.75 * sag) / tolerance))))
  for (let i = 1; i <= pieces; i++) {
    const t = i / pieces
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const e = t * t * t
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1],
    ])
  }
}
