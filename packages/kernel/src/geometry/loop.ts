/**
 * Closed 2D section profiles as loops of cubic Bézier segments — the cross-sections that
 * sweeps carry along a path. Loops run counter-clockwise; consecutive segments share endpoints.
 */
import type { Vec2 } from './vec'

export type Bezier2 = readonly [Vec2, Vec2, Vec2, Vec2]
export type Loop = readonly Bezier2[]

export const lineSegment = (a: Vec2, b: Vec2): Bezier2 => [
  a,
  [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3],
  [a[0] + ((b[0] - a[0]) * 2) / 3, a[1] + ((b[1] - a[1]) * 2) / 3],
  b,
]

/**
 * Circular arc about `c` from angle `a0` to `a1` (radians, either direction) as one cubic.
 * Keep the sweep ≤ 90°: the radial error is then below 0.03 % of the radius.
 */
export function arcSegment(c: Vec2, r: number, a0: number, a1: number): Bezier2 {
  const k = (4 / 3) * Math.tan((a1 - a0) / 4) * r
  const p0: Vec2 = [c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)]
  const p3: Vec2 = [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)]
  return [
    p0,
    [p0[0] - k * Math.sin(a0), p0[1] + k * Math.cos(a0)],
    [p3[0] + k * Math.sin(a1), p3[1] - k * Math.cos(a1)],
    p3,
  ]
}

/** An arc split into `pieces` equal cubics. */
export function arcSegments(c: Vec2, r: number, a0: number, a1: number, pieces: number): Bezier2[] {
  return Array.from({ length: pieces }, (_, i) =>
    arcSegment(c, r, a0 + ((a1 - a0) * i) / pieces, a0 + ((a1 - a0) * (i + 1)) / pieces),
  )
}

/**
 * The circular arc through `a` and `b` that bulges `sagitta` to the right of a→b (negative:
 * to the left), as `pieces` cubics. A zero sagitta gives straight segments.
 */
export function bulgeSegments(a: Vec2, b: Vec2, sagitta: number, pieces = 2): Bezier2[] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const chord = Math.hypot(dx, dy)
  if (Math.abs(sagitta) < 1e-9 * Math.max(1, chord)) {
    return Array.from({ length: pieces }, (_, i) =>
      lineSegment(
        [a[0] + (dx * i) / pieces, a[1] + (dy * i) / pieces],
        [a[0] + (dx * (i + 1)) / pieces, a[1] + (dy * (i + 1)) / pieces],
      ),
    )
  }
  const r = (chord * chord) / (8 * Math.abs(sagitta)) + Math.abs(sagitta) / 2
  const side = Math.sign(sagitta)
  // Unit normal to the right of a→b; the centre lies on the opposite side of the bulge.
  const nx = dy / chord
  const ny = -dx / chord
  const off = side * (Math.abs(sagitta) - r)
  const c: Vec2 = [(a[0] + b[0]) / 2 + nx * off, (a[1] + b[1]) / 2 + ny * off]
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0])
  let a1 = Math.atan2(b[1] - c[1], b[0] - c[0])
  // Bulging right of a→b means travelling counter-clockwise about the centre.
  if (side > 0 && a1 < a0) a1 += 2 * Math.PI
  if (side < 0 && a1 > a0) a1 -= 2 * Math.PI
  return arcSegments(c, r, a0, a1, pieces)
}

/** Ellipse centred on the origin, as four quarter arcs starting at +x. */
export function ellipseLoop(rx: number, ry: number): Loop {
  return arcSegments([0, 0], 1, 0, 2 * Math.PI, 4).map(
    (seg) => seg.map(([x, y]) => [x * rx, y * ry] as Vec2) as unknown as Bezier2,
  )
}

export const circleLoop = (r: number): Loop => ellipseLoop(r, r)

/** Rectangle centred on the origin with rounded corners: 4 sides + 4 corner arcs. */
export function roundedRectLoop(w: number, h: number, radius: number): Loop {
  const r = Math.max(Math.min(radius, w / 2 - 1e-4, h / 2 - 1e-4), 1e-4)
  const x = w / 2
  const y = h / 2
  const q = Math.PI / 2
  return [
    lineSegment([-x + r, -y], [x - r, -y]),
    arcSegment([x - r, -y + r], r, -q, 0),
    lineSegment([x, -y + r], [x, y - r]),
    arcSegment([x - r, y - r], r, 0, q),
    lineSegment([x - r, y], [-x + r, y]),
    arcSegment([-x + r, y - r], r, q, 2 * q),
    lineSegment([-x, y - r], [-x, -y + r]),
    arcSegment([-x + r, -y + r], r, 2 * q, 3 * q),
  ]
}

/**
 * Half-round ("D") wire: flat on y = 0 across the width, domed above, with softened corners.
 * 2 corner arcs + flat + dome in two pieces.
 */
export function halfRoundLoop(w: number, h: number): Loop {
  const x = w / 2
  const r = Math.min(w, h) * 0.12
  const q = Math.PI / 2
  return [
    lineSegment([-x + r, 0], [x - r, 0]),
    arcSegment([x - r, r], r, -q, 0),
    ...domeSegments([x, r], [-x, r], h - r),
    arcSegment([-x + r, r], r, 2 * q, 3 * q),
  ]
}

/** Half-ellipse from `a` to `b` (same height) rising `rise` above them, as two cubics. */
export function domeSegments(a: Vec2, b: Vec2, rise: number): Bezier2[] {
  const cx = (a[0] + b[0]) / 2
  const rx = (a[0] - b[0]) / 2
  return arcSegments([0, 0], 1, 0, Math.PI, 2).map(
    (seg) => seg.map(([x, y]) => [cx + x * rx, a[1] + y * rise] as Vec2) as unknown as Bezier2,
  )
}

export const scaleLoop = (loop: Loop, sx: number, sy = sx): Loop =>
  loop.map((seg) => seg.map(([x, y]) => [x * sx, y * sy] as Vec2) as unknown as Bezier2)

export const translateLoop = (loop: Loop, dx: number, dy: number): Loop =>
  loop.map((seg) => seg.map(([x, y]) => [x + dx, y + dy] as Vec2) as unknown as Bezier2)

export const rotateLoop = (loop: Loop, angle: number): Loop => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return loop.map(
    (seg) => seg.map(([x, y]) => [x * c - y * s, x * s + y * c] as Vec2) as unknown as Bezier2,
  )
}

export function bezierPoint([p0, p1, p2, p3]: Bezier2, t: number): Vec2 {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ]
}

/**
 * A cubic that leaves `p0` along `d0` and arrives at `p3` along `d3` (unit directions): the
 * tangent-continuous blend used for softened corners. Handle lengths follow the circular-arc
 * rule, so equal-length blends through 90° are quarter circles.
 */
export function blendSegment(p0: Vec2, d0: Vec2, p3: Vec2, d3: Vec2): Bezier2 {
  const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1])
  const turn = Math.acos(Math.min(1, Math.max(-1, d0[0] * d3[0] + d0[1] * d3[1])))
  const k = turn < 1e-6 ? 1 / 3 : ((2 / 3) * Math.tan(turn / 4)) / Math.sin(turn / 2)
  const h = chord * k
  return [p0, [p0[0] + d0[0] * h, p0[1] + d0[1] * h], [p3[0] - d3[0] * h, p3[1] - d3[1] * h], p3]
}

/** Unit tangent of a segment at its start (t = 0) or end (t = 1). */
export function segmentTangent(seg: Bezier2, atEnd: boolean): Vec2 {
  const [a, b] = atEnd ? [seg[2], seg[3]] : [seg[0], seg[1]]
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
}
