/**
 * A placed stone's shape in millimetres, in its own frame: what settings, halos and seats
 * measure against. x/y span the girdle plane, z points out of the table.
 */
import type { Stone } from '../core'
import { fromFrame, type Vec2, type Vec3 } from '../geometry/vec'
import { type GemUnit, gemUnit } from './index'
import { outlineAnchors, outlinePoint } from './outline'

const TAU = Math.PI * 2

export interface OutlinePolygon {
  /** Girdle points, counter-clockwise. */
  points: Vec2[]
  /** Outward unit normals (the bisector at corners). */
  normals: Vec2[]
  /** Direction of each point from the outline's centre. */
  phis: number[]
  /** Indices of sharp corners. */
  corners: number[]
}

export interface StoneShape {
  stone: Stone
  unit: GemUnit
  /** Scale from unit coordinates to mm. */
  sx: number
  sy: number
  sz: number
  /** Centre of table and culet in the girdle plane. */
  centre: Vec2
  /** Heights of the girdle edges, table and culet (culet and girdleBottom are negative). */
  girdleTop: number
  girdleBottom: number
  table: number
  culet: number
  /** Girdle point in direction φ from the centre. */
  point(phi: number): Vec2
  /** Outward unit normal of the girdle at φ; at a corner, the bisector of the two sides. */
  normal(phi: number): Vec2
  /** Scale of the girdle outline at height z (1 on the girdle band, tapering to table and culet). */
  scaleAt(z: number): number
  /** The stone's silhouette point at height z in direction φ. */
  silhouette(phi: number, z: number): Vec2
  /** The girdle as a polygon with `perSpan` points per ≤ 45° span. */
  polygon(perSpan: number): OutlinePolygon
  /**
   * The girdle outline offset outward by `distance`, as a closed polyline in the girdle plane.
   * Sharp corners are rounded, so the path stays `distance` from the stone all the way round.
   */
  offsetPath(distance: number): Vec2[]
  /** Stone coordinates → world. */
  toWorld(p: Vec3): Vec3
}

export function stoneShape(stone: Stone): StoneShape {
  const unit = gemUnit(stone.cut, stone.dims.length / stone.dims.width)
  const sx = stone.dims.width
  const sy = stone.dims.length / unit.length
  const sz = stone.dims.depth / unit.depth
  const o = unit.outline
  const centre: Vec2 = [o.centre[0] * sx, o.centre[1] * sy]
  const point = (phi: number): Vec2 => {
    const p = outlinePoint(o, phi)
    return [p[0] * sx, p[1] * sy]
  }
  const sideNormal = (phi: number, side: 1 | -1): Vec2 => {
    const h = 1e-4
    const a = point(side > 0 ? phi : phi - h)
    const b = point(side > 0 ? phi + h : phi)
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]
  }
  const normal = (phi: number): Vec2 => {
    const a = sideNormal(phi, -1)
    const b = sideNormal(phi, 1)
    const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1
    return [(a[0] + b[0]) / l, (a[1] + b[1]) / l]
  }
  const levels = unit.stack.map((l) => ({ z: l.z * sz, scale: l.scale }))
  const girdleIndex = levels.findIndex(
    (l, i) => i > 0 && l.scale === 1 && levels[i - 1]!.scale === 1,
  )
  const scaleAt = (z: number): number => {
    if (z <= levels[0]!.z) return levels[0]!.scale
    for (let i = 0; i + 1 < levels.length; i++) {
      const a = levels[i]!
      const b = levels[i + 1]!
      if (z <= b.z) return a.scale + ((b.scale - a.scale) * (z - a.z)) / (b.z - a.z)
    }
    return levels[levels.length - 1]!.scale
  }
  const keel = unit.keel * sy
  return {
    stone,
    unit,
    sx,
    sy,
    sz,
    centre,
    girdleTop: levels[girdleIndex]!.z,
    girdleBottom: levels[girdleIndex - 1]!.z,
    table: levels[levels.length - 1]!.z,
    culet: levels[0]!.z,
    point,
    normal,
    scaleAt,
    silhouette(phi, z) {
      const [x, y] = point(phi)
      const s = scaleAt(z)
      const anchor = centre[1] + Math.min(keel, Math.max(-keel, y - centre[1]))
      return [centre[0] + (x - centre[0]) * s, anchor + (y - anchor) * s]
    },
    polygon(perSpan) {
      const anchors = outlineAnchors(o)
      const sharp = new Set(o.corners.map((c) => Math.round((((c % TAU) + TAU) % TAU) * 1e6)))
      const out: OutlinePolygon = { points: [], normals: [], phis: [], corners: [] }
      anchors.forEach((a, i) => {
        const next = i + 1 < anchors.length ? anchors[i + 1]! : anchors[0]! + TAU
        for (let m = 0; m < perSpan; m++) {
          const phi = a + ((next - a) * m) / perSpan
          if (m === 0 && sharp.has(Math.round(a * 1e6))) out.corners.push(out.points.length)
          out.points.push(point(phi))
          out.normals.push(normal(phi))
          out.phis.push(phi)
        }
      })
      return out
    },
    offsetPath(distance) {
      const anchors = outlineAnchors(o)
      const sharp = new Set(o.corners.map((c) => Math.round((((c % TAU) + TAU) % TAU) * 1e6)))
      const path: Vec2[] = []
      anchors.forEach((a, i) => {
        const next = i + 1 < anchors.length ? anchors[i + 1]! : anchors[0]! + TAU
        const steps = 12
        for (let m = 0; m < steps; m++) {
          const phi = a + ((next - a) * m) / steps
          const p = point(phi)
          if (m === 0 && sharp.has(Math.round(a * 1e6))) {
            // Swing the normal from the incoming side to the outgoing one. (At a concave
            // corner — a heart's cleft — the two would cross, so use the bisector alone.)
            const from = sideNormal(phi, -1)
            const to = sideNormal(phi, 1)
            const turn = Math.atan2(
              from[0] * to[1] - from[1] * to[0],
              from[0] * to[0] + from[1] * to[1],
            )
            if (turn > 0)
              for (let k = 0; k <= 4; k++) {
                const t = (turn * k) / 4
                const c = Math.cos(t)
                const sn = Math.sin(t)
                path.push([
                  p[0] + (from[0] * c - from[1] * sn) * distance,
                  p[1] + (from[0] * sn + from[1] * c) * distance,
                ])
              }
            else {
              const n = normal(phi)
              path.push([p[0] + n[0] * distance, p[1] + n[1] * distance])
            }
          } else {
            const n = normal(phi)
            path.push([p[0] + n[0] * distance, p[1] + n[1] * distance])
          }
        }
      })
      return path
    },
    toWorld: (p) => fromFrame(stone.frame, p),
  }
}

/**
 * Directions for `count` claws: first on the outline's own claw positions (points and cut
 * corners), the rest spread evenly by girth through the gaps. Shapes without such positions get
 * evenly spaced directions starting at `spin`.
 */
export function prongDirections(
  shape: StoneShape,
  count: number,
  spin: number,
): { phi: number; point: boolean }[] {
  const fixed = shape.unit.outline.prongs
  if (fixed.length === 0)
    return Array.from({ length: count }, (_, i) => ({
      phi: spin + (i * TAU) / count,
      point: false,
    }))
  if (count <= fixed.length) {
    // Fewer claws than points: keep them as far apart as possible.
    return Array.from({ length: count }, (_, i) => fixed[Math.floor((i * fixed.length) / count)]!)
  }
  // Arc length along the outline as a function of direction.
  const poly = shape.polygon(16)
  const n = poly.points.length
  const cumulative = [0]
  for (let i = 0; i < n; i++) {
    const p = poly.points[i]!
    const q = poly.points[(i + 1) % n]!
    cumulative.push(cumulative[i]! + Math.hypot(q[0] - p[0], q[1] - p[1]))
  }
  const girth = cumulative[n]!
  const first = poly.phis[0]!
  const lengthAt = (phi: number): number => {
    const rel = (((phi - first) % TAU) + TAU) % TAU
    let i = 0
    while (i + 1 < n && poly.phis[i + 1]! - first <= rel) i++
    const span = (i + 1 < n ? poly.phis[i + 1]! : first + TAU) - poly.phis[i]!
    return (
      cumulative[i]! +
      ((rel - (poly.phis[i]! - first)) / span) * (cumulative[i + 1]! - cumulative[i]!)
    )
  }
  const phiAt = (s: number): number => {
    const t = ((s % girth) + girth) % girth
    let i = 0
    while (i + 1 < n && cumulative[i + 1]! <= t) i++
    const span = (i + 1 < n ? poly.phis[i + 1]! : first + TAU) - poly.phis[i]!
    return poly.phis[i]! + ((t - cumulative[i]!) / (cumulative[i + 1]! - cumulative[i]!)) * span
  }
  const stops = fixed.map((f) => ({ ...f, s: lengthAt(f.phi) })).sort((a, b) => a.s - b.s)
  const gaps = stops.map((stop, i) => {
    const next = stops[(i + 1) % stops.length]!
    return {
      from: stop.s,
      length: (((next.s - stop.s) % girth) + girth) % girth || girth,
      extra: 0,
    }
  })
  // Hand out the remaining claws one at a time to the gap whose spacing is currently widest.
  for (let k = fixed.length; k < count; k++) {
    let widest = gaps[0]!
    for (const g of gaps)
      if (g.length / (g.extra + 1) > widest.length / (widest.extra + 1)) widest = g
    widest.extra++
  }
  const out = stops.map(({ phi, point }) => ({ phi, point }))
  for (const g of gaps)
    for (let k = 1; k <= g.extra; k++)
      out.push({ phi: phiAt(g.from + (g.length * k) / (g.extra + 1)), point: false })
  return out
}
