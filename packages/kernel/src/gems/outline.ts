/**
 * Girdle outlines of every gem shape, for a girdle width of 1 (x) and a length of `lw` (y).
 *
 * An outline is star-shaped about its centre, so it is stored as a polar function r(φ). Settings
 * and halos follow the same function the facets are built from, which is what makes a bezel hug
 * a pear and a halo run parallel to a cushion.
 *
 * Orientation: length along +y. Pear and heart point toward −y (so they hang point-down once a
 * pendant stands them up); the heart's cleft and the trillion's apex are at +y.
 */
import type { GemOutline } from '@pave/schema'
import type { Bezier2, Loop } from '../geometry/loop'
import type { Vec2 } from '../geometry/vec'

export interface Outline {
  /** Girdle length for a width of 1. */
  length: number
  /** Where the table and culet are centred. */
  centre: Vec2
  /** Distance from `centre` to the girdle in direction φ (radians, 0 = +x, counter-clockwise). */
  radius(phi: number): number
  /** Directions of sharp corners (points, cut-corner vertices). Empty for smooth outlines. */
  corners: number[]
  /** Directions of the main (kite) facets of a brilliant, ascending in [0, 2π). */
  mains: number[]
  /**
   * For each main, the direction where the two half facets between it and the next main meet.
   * Usually the bisector; a polygon vertex when one lies in between.
   */
  breaks: number[]
}

const TAU = Math.PI * 2
const norm = (a: number): number => ((a % TAU) + TAU) % TAU

type Primitive =
  | { type: 'line'; a: Vec2; b: Vec2 }
  /** Arc of the circle about `c`, radius `r`; hits are accepted on the side where `keep` holds. */
  | { type: 'arc'; c: Vec2; r: number; keep: (p: Vec2) => boolean }

/** Polar radius function for a star-shaped outline made of lines and arcs. */
function polar(centre: Vec2, primitives: readonly Primitive[]): (phi: number) => number {
  return (phi) => {
    const dx = Math.cos(phi)
    const dy = Math.sin(phi)
    let best = Infinity
    for (const prim of primitives) {
      if (prim.type === 'line') {
        const ex = prim.b[0] - prim.a[0]
        const ey = prim.b[1] - prim.a[1]
        const det = ex * dy - ey * dx
        if (Math.abs(det) < 1e-12) continue
        const ax = prim.a[0] - centre[0]
        const ay = prim.a[1] - centre[1]
        const t = (ex * ay - ey * ax) / det
        const s = (dx * ay - dy * ax) / det
        if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = t
      } else {
        const ox = centre[0] - prim.c[0]
        const oy = centre[1] - prim.c[1]
        const b = ox * dx + oy * dy
        const disc = b * b - (ox * ox + oy * oy - prim.r * prim.r)
        if (disc < 0) continue
        for (const t of [-b - Math.sqrt(disc), -b + Math.sqrt(disc)]) {
          if (t <= 1e-9 || t >= best) continue
          if (prim.keep([centre[0] + dx * t, centre[1] + dy * t])) best = t
        }
      }
    }
    return Number.isFinite(best) ? best : 0
  }
}

const angleTo = (centre: Vec2, p: Vec2): number => norm(Math.atan2(p[1] - centre[1], p[0] - centre[0]))

/** Mains at equal angular steps starting from `first`, each break halfway to the next. */
function evenMains(count: number, first = 0): Pick<Outline, 'mains' | 'breaks'> {
  const mains = Array.from({ length: count }, (_, k) => norm(first + (k * TAU) / count)).sort((a, b) => a - b)
  return { mains, breaks: mains.map((m) => norm(m + Math.PI / count)) }
}

/**
 * Mains on the given points, each break halfway (in direction) to the next main. Used for
 * curved outlines, where mains sit on "corners" and side middles alike.
 */
function mainsAt(centre: Vec2, points: readonly Vec2[]): Pick<Outline, 'mains' | 'breaks'> {
  const mains = points.map((p) => angleTo(centre, p)).sort((a, b) => a - b)
  return {
    mains,
    breaks: mains.map((m, k) => {
      const next = mains[(k + 1) % mains.length]! + (k + 1 === mains.length ? TAU : 0)
      return norm((m + next) / 2)
    }),
  }
}

/**
 * Mains on the vertices of a straight-sided polygon, breaks at the middle of each side. (A main
 * in the middle of a straight side would be coplanar with its half facets and vanish.)
 */
function polygonMains(centre: Vec2, vertices: readonly Vec2[]): Pick<Outline, 'mains' | 'breaks'> {
  const order = vertices
    .map((p, i) => {
      const q = vertices[(i + 1) % vertices.length]!
      return { main: angleTo(centre, p), brk: angleTo(centre, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]) }
    })
    .sort((a, b) => a.main - b.main)
  return { mains: order.map((o) => o.main), breaks: order.map((o) => o.brk) }
}

function ellipse(length: number): Outline {
  const a = 0.5
  const b = length / 2
  return {
    length,
    centre: [0, 0],
    radius: (phi) => (a * b) / Math.hypot(b * Math.cos(phi), a * Math.sin(phi)),
    corners: [],
    ...evenMains(8),
  }
}

/** A "pillow": superellipse of exponent 4 — bowed sides, generously rounded corners. */
function cushion(length: number): Outline {
  const a = 0.5
  const b = length / 2
  return {
    length,
    centre: [0, 0],
    radius: (phi) => (Math.abs(Math.cos(phi) / a) ** 4 + Math.abs(Math.sin(phi) / b) ** 4) ** -0.25,
    corners: [],
    // Mains on the corners (the diagonals of the bounding box) and the middles of the sides.
    ...mainsAt([0, 0], [[a, b], [-a, b], [-a, -b], [a, -b], [a, 0], [0, b], [-a, 0], [0, -b]]),
  }
}

/** Rectangle with corners cut by `cut` (fraction of the width); `cut` = 0 keeps them sharp. */
function rectangle(length: number, cut: number): Outline {
  const a = 0.5
  const b = length / 2
  const c = Math.min(cut, 0.45)
  const centre: Vec2 = [0, 0]
  if (c < 1e-6) {
    const pts: Vec2[] = [[a, b], [-a, b], [-a, -b], [a, -b]]
    return {
      length,
      centre,
      radius: polar(centre, pts.map((p, i) => ({ type: 'line', a: p, b: pts[(i + 1) % 4]! }))),
      corners: pts.map((p) => angleTo(centre, p)).sort((x, y) => x - y),
      ...polygonMains(centre, pts),
    }
  }
  // Octagon, counter-clockwise from the right side's lower end.
  const pts: Vec2[] = [
    [a, -b + c], [a, b - c], [a - c, b], [-a + c, b],
    [-a, b - c], [-a, -b + c], [-a + c, -b], [a - c, -b],
  ] // biome-ignore format: one row per pair of vertices
  return {
    length,
    centre,
    radius: polar(centre, pts.map((p, i) => ({ type: 'line', a: p, b: pts[(i + 1) % 8]! }))),
    corners: pts.map((p) => angleTo(centre, p)).sort((x, y) => x - y),
    ...polygonMains(centre, pts),
  }
}

/** A circle for the head and two arcs, tangent to it at the widest point, meeting at the tip. */
function pear(length: number): Outline {
  const cy = length / 2 - 0.5
  const h = length - 0.5
  const big = 0.25 + h * h
  const tip: Vec2 = [0, -length / 2]
  const centre: Vec2 = [0, cy * 0.45]
  return {
    length,
    centre,
    radius: polar(centre, [
      { type: 'arc', c: [0, cy], r: 0.5, keep: (p) => p[1] >= cy },
      { type: 'arc', c: [0.5 - big, cy], r: big, keep: (p) => p[1] <= cy && p[0] >= 0 },
      { type: 'arc', c: [big - 0.5, cy], r: big, keep: (p) => p[1] <= cy && p[0] <= 0 },
    ]),
    corners: [angleTo(centre, tip)],
    ...evenMains(8, -Math.PI / 2),
  }
}

/** Two arcs through the widest points, meeting in a point at each end. */
function marquise(length: number): Outline {
  const big = 0.25 + (length * length) / 4
  return {
    length,
    centre: [0, 0],
    radius: polar([0, 0], [
      { type: 'arc', c: [0.5 - big, 0], r: big, keep: (p) => p[0] >= 0 },
      { type: 'arc', c: [big - 0.5, 0], r: big, keep: (p) => p[0] <= 0 },
    ]),
    corners: [Math.PI / 2, (3 * Math.PI) / 2],
    ...evenMains(8),
  }
}

/** Two overlapping lobes over two arcs that meet in the point; the lobes' overlap is the cleft. */
function heart(length: number): Outline {
  // Lobe circles of radius 0.27 centred 0.23 off-axis: 0.5 wide in total, cleft 0.13 deep.
  const lobe = 0.27
  const off = 0.23
  const cy = length / 2 - lobe
  const h = cy + length / 2
  const big = 0.25 + h * h
  const centre: Vec2 = [0, cy - 0.12 * length]
  const cleft: Vec2 = [0, cy + Math.sqrt(lobe * lobe - off * off)]
  return {
    length,
    centre,
    radius: polar(centre, [
      { type: 'arc', c: [off, cy], r: lobe, keep: (p) => p[1] >= cy && p[0] >= 0 },
      { type: 'arc', c: [-off, cy], r: lobe, keep: (p) => p[1] >= cy && p[0] <= 0 },
      { type: 'arc', c: [0.5 - big, cy], r: big, keep: (p) => p[1] <= cy && p[0] >= 0 },
      { type: 'arc', c: [big - 0.5, cy], r: big, keep: (p) => p[1] <= cy && p[0] <= 0 },
    ]),
    corners: [angleTo(centre, cleft), angleTo(centre, [0, -length / 2])],
    ...evenMains(8, Math.PI / 2),
  }
}

/** Triangle with gently bowed sides: apex at +y, base at −y. */
function triangle(length: number): Outline {
  // Each side is an arc through its two corners bulging 5 % of the width; the base corners are
  // raised by that much so the bowed base still ends at −length / 2.
  const sag = 0.05
  const pts: Vec2[] = [[0, length / 2], [-0.5, -length / 2 + sag], [0.5, -length / 2 + sag]]
  const centre: Vec2 = [0, -length / 6]
  const primitives: Primitive[] = []
  const sideMids: Vec2[] = []
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % 3]!
    const chord = Math.hypot(q[0] - p[0], q[1] - p[1])
    const r = (chord * chord) / (8 * sag) + sag / 2
    const mx = (p[0] + q[0]) / 2
    const my = (p[1] + q[1]) / 2
    // Outward normal of a counter-clockwise polygon side.
    const nx = (q[1] - p[1]) / chord
    const ny = -(q[0] - p[0]) / chord
    const c: Vec2 = [mx - nx * (r - sag), my - ny * (r - sag)]
    sideMids.push([mx + nx * sag, my + ny * sag])
    primitives.push({
      type: 'arc',
      c,
      r,
      keep: (hit) => (hit[0] - mx) * nx + (hit[1] - my) * ny >= -1e-9,
    })
  })
  return {
    length,
    centre,
    radius: polar(centre, primitives),
    corners: pts.map((p) => angleTo(centre, p)).sort((a, b) => a - b),
    // The sides are bowed, so mains in their middles are real facets.
    ...mainsAt(centre, [...pts, ...sideMids]),
  }
}

export function outlineFor(shape: GemOutline, length: number, cornerCut: number): Outline {
  switch (shape) {
    case 'round':
      return ellipse(1)
    case 'oval':
      return ellipse(length)
    case 'square':
    case 'rect':
      return rectangle(length, cornerCut)
    case 'cushion':
      return cushion(length)
    case 'pear':
      return pear(length)
    case 'marquise':
      return marquise(length)
    case 'heart':
      return heart(length)
    case 'triangle':
      return triangle(length)
  }
}

/** The girdle point in direction φ. */
export const outlinePoint = (o: Outline, phi: number): Vec2 => {
  const r = o.radius(phi)
  return [o.centre[0] + r * Math.cos(phi), o.centre[1] + r * Math.sin(phi)]
}

/**
 * Directions that split the outline into spans of at most ~45°: every corner plus evenly
 * spread directions in between. Ascending in [0, 2π).
 */
export function outlineAnchors(o: Outline): number[] {
  const anchors = o.corners.map(norm)
  for (let k = 0; k < 8; k++) {
    const a = (k * TAU) / 8
    if (!anchors.some((c) => Math.abs(c - a) < 0.25 || Math.abs(c - a) > TAU - 0.25)) anchors.push(a)
  }
  return anchors.sort((a, b) => a - b)
}

/**
 * The outline as a closed polygon (counter-clockwise) with `perSpan` points per anchor span.
 * Corners are always vertices, so points and cut corners stay sharp.
 */
export function outlinePolygon(o: Outline, perSpan = 8): Vec2[] {
  const anchors = outlineAnchors(o)
  const points: Vec2[] = []
  anchors.forEach((a, i) => {
    const next = i + 1 < anchors.length ? anchors[i + 1]! : anchors[0]! + TAU
    for (let m = 0; m < perSpan; m++) points.push(outlinePoint(o, a + ((next - a) * m) / perSpan))
  })
  return points
}

/** Unit tangent (counter-clockwise) just after (side = 1) or just before (−1) direction φ. */
export function outlineTangent(o: Outline, phi: number, side: 1 | -1 = 1): Vec2 {
  const h = 1e-4
  const a = outlinePoint(o, side > 0 ? phi : phi - h)
  const b = outlinePoint(o, side > 0 ? phi + h : phi)
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
}

/**
 * The outline as a loop of cubic Béziers, one per anchor span, for sweeps whose section is the
 * stone's shape (seat cutters, bezel cups). Each cubic matches the outline's end points, end
 * tangents and mid point; the fit is within ~1e-4 of the width.
 */
export function outlineLoop(o: Outline): Loop {
  const anchors = outlineAnchors(o)
  return anchors.map((a, i): Bezier2 => {
    const next = i + 1 < anchors.length ? anchors[i + 1]! : anchors[0]! + TAU
    const p0 = outlinePoint(o, a)
    const p3 = outlinePoint(o, next)
    const t0 = outlineTangent(o, a, 1)
    const t1 = outlineTangent(o, next, -1)
    const mid = outlinePoint(o, (a + next) / 2)
    // B(½) = (p0 + p3)/2 + ⅜·h·(t0 − t1): choose the handle length h that reaches the mid point.
    const dx = t0[0] - t1[0]
    const dy = t0[1] - t1[1]
    const bend = dx * dx + dy * dy
    const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1])
    const h =
      bend < 1e-8
        ? chord / 3
        : ((8 / 3) * ((mid[0] - (p0[0] + p3[0]) / 2) * dx + (mid[1] - (p0[1] + p3[1]) / 2) * dy)) / bend
    const handle = Math.min(Math.max(h, chord * 0.1), chord * 0.6)
    return [p0, [p0[0] + t0[0] * handle, p0[1] + t0[1] * handle], [p3[0] - t1[0] * handle, p3[1] - t1[1] * handle], p3]
  })
}
