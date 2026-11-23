/**
 * Facet generators: every cut as a list of planar polygons for a girdle width of 1, girdle
 * plane at z = 0 and the table toward +z. Proportions come from @pave/schema's GEM_CUTS.
 *
 * Brilliant-style cuts (round and every fancy brilliant) share one construction on the true
 * outline: table, K star facets, K kite (bezel/main) facets and 2K upper-girdle facets on the
 * crown; 2K lower-girdle facets and K mains on the pavilion — 57 facets for K = 8. Kites and
 * mains are exactly planar: each star point is the intersection of the two neighbouring kite
 * planes with a height plane. The girdle is a band of flat facets whose upper and lower edges
 * are where the half facets meet it, which gives the scalloped girdle of a real stone.
 */
import type { GemCut } from '@pave/schema'
import { type Vec2, type Vec3, cross, dot, normalize, sub } from '../geometry/vec'
import { type Outline, outlinePoint } from './outline'

export type FacetKind =
  | 'table'
  | 'star'
  | 'kite'
  | 'upperGirdle'
  | 'girdle'
  | 'lowerGirdle'
  | 'pavilionMain'
  | 'crownStep'
  | 'pavilionStep'

export interface Facet {
  kind: FacetKind
  /** Planar polygon; orientation is fixed up by the mesher. */
  points: Vec3[]
}

/** One level of a stone's silhouette: the girdle outline scaled by `scale` at height `z`. */
export interface StackLevel {
  z: number
  scale: number
}

export interface Faceted {
  facets: Facet[]
  /** The silhouette from culet to table, for seat cutters and collision tests. */
  stack: StackLevel[]
  /** Half-length of the keel the levels shrink toward (0: they shrink toward the centre). */
  keel: number
}

/** Heights for a girdle width of 1: girdle top/bottom at the mains, table and culet. */
export interface Levels {
  girdleTop: number
  girdleBottom: number
  table: number
  culet: number
}

export function levelsOf(cut: GemCut, girdle = cut.girdlePct): Levels {
  // A thicker girdle (needed by strongly curved outlines) is taken equally from crown and pavilion.
  const extra = (girdle - cut.girdlePct) / 2
  return {
    girdleTop: girdle / 2,
    girdleBottom: -girdle / 2,
    table: girdle / 2 + cut.crownPct - extra,
    culet: -girdle / 2 - cut.pavilionPct + extra,
  }
}

const TAU = Math.PI * 2
/** Star facets reach 50 % and lower halves 77 % of the way (docs/research/01-cad.md §3). */
const STAR_LENGTH = 0.5
const LOWER_HALF_LENGTH = 0.77

interface Plane {
  n: Vec3
  d: number
}

const planeThrough = (a: Vec3, b: Vec3, c: Vec3): Plane => {
  const n = normalize(cross(sub(b, a), sub(c, a)))
  return { n, d: dot(n, a) }
}

const heightOn = (plane: Plane, p: Vec2): number => (plane.d - plane.n[0] * p[0] - plane.n[1] * p[1]) / plane.n[2]

/** The point at height z on the line where two planes meet, or null if they are parallel. */
function meetAt(a: Plane, b: Plane, z: number): Vec3 | null {
  const det = a.n[0] * b.n[1] - a.n[1] * b.n[0]
  if (Math.abs(det) < 1e-9) return null
  const ra = a.d - a.n[2] * z
  const rb = b.d - b.n[2] * z
  return [(ra * b.n[1] - rb * a.n[1]) / det, (a.n[0] * rb - b.n[0] * ra) / det, z]
}

/** A facet plane through an apex-side point and a girdle point, level across the slope. */
function slopePlane(inner: Vec3, outer: Vec3): { plane: Plane; direction: Vec2 } {
  const run = Math.hypot(outer[0] - inner[0], outer[1] - inner[1])
  const direction: Vec2 = [(outer[0] - inner[0]) / run, (outer[1] - inner[1]) / run]
  const n = normalize([direction[0] * (inner[2] - outer[2]), direction[1] * (inner[2] - outer[2]), run])
  return { plane: { n, d: dot(n, inner) }, direction }
}

export interface BrilliantOptions {
  /** Girdle facets per half facet (between a main and the next break). */
  girdleSteps: number
}

/**
 * One half of the gem — crown or pavilion; they share the construction. `apexScale` is the size
 * of the apex polygon relative to the girdle (the table; 0 collapses it to the culet) and
 * `reach` how far the half facets' meeting points sit from the apex toward the girdle.
 */
function brilliantHalf(
  o: Outline,
  apexScale: number,
  girdleZ: number,
  apexZ: number,
  reach: number,
  steps: number,
  /** The most a half facet may bite into the girdle band (deeper bites are flattened). */
  maxDip: number,
): { ring: Vec3[]; facets: Facet[]; dip: number } {
  const crown = apexZ > girdleZ
  const K = o.mains.length
  const girdle = o.mains.map((phi) => outlinePoint(o, phi))
  // Table corners (crown) or the culet (pavilion, apexScale = 0).
  const apex: Vec3[] = girdle.map((g) => [
    o.centre[0] + (g[0] - o.centre[0]) * apexScale,
    o.centre[1] + (g[1] - o.centre[1]) * apexScale,
    apexZ,
  ])
  const slopes = girdle.map((g, k) => slopePlane(apex[k]!, [g[0], g[1], girdleZ]))
  const mid: Vec3[] = []
  for (let k = 0; k < K; k++) {
    const a = slopes[k]!
    const b = slopes[(k + 1) % K]!
    const c = Math.sqrt((1 + a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1]) / 2)
    // Height fraction (from the girdle) of the point where the half facets end, from the
    // round-brilliant relation between facet length and height on the main facet's plane.
    const t = apexScale * c
    const lambda = (1 - (t + reach * (1 - t)) * c) / (1 - apexScale)
    const brk = outlinePoint(o, o.breaks[k]!)
    // Where the point would be without the planarity constraint: between apex edge and girdle.
    const aimAt = (z: number): Vec3 => [
      (apex[k]![0] + apex[(k + 1) % K]![0]) / 4 + brk[0] / 2,
      (apex[k]![1] + apex[(k + 1) % K]![1]) / 4 + brk[1] / 2,
      z,
    ]
    const height = (f: number) => girdleZ + (apexZ - girdleZ) * f
    const met = lambda > 0.08 && lambda < 0.92 ? meetAt(a.plane, b.plane, height(lambda)) : null
    // Widely spaced mains (a princess has four) or a concave outline (a heart's cleft) put the
    // planes' meeting point outside the stone; those kites are folded along their diagonal
    // instead of planar.
    const fallback = aimAt(height(crown ? 0.6 : 0.78))
    // Usable only if it lies inside the girdle, in the sector between the two mains.
    let ok = false
    if (met) {
      const dx = met[0] - o.centre[0]
      const dy = met[1] - o.centre[1]
      const between = (dx * a.direction[0] + dy * a.direction[1] > 0) && (dx * b.direction[0] + dy * b.direction[1] > 0)
      ok = between && Math.hypot(dx, dy) < 0.98 * o.radius(Math.atan2(dy, dx))
    }
    mid.push(ok && met ? met : fallback)
  }

  const facets: Facet[] = []
  const ring: Vec3[] = []
  let dip = 0
  for (let k = 0; k < K; k++) {
    const next = (k + 1) % K
    const prev = (k + K - 1) % K
    const g0: Vec3 = [girdle[k]![0], girdle[k]![1], girdleZ]
    const g1: Vec3 = [girdle[next]![0], girdle[next]![1], girdleZ]
    const brk2 = outlinePoint(o, o.breaks[k]!)
    const gb: Vec3 = [brk2[0], brk2[1], girdleZ]
    if (apexScale > 0) facets.push({ kind: 'star', points: [apex[k]!, mid[k]!, apex[next]!] })
    facets.push({ kind: crown ? 'kite' : 'pavilionMain', points: [apex[k]!, mid[prev]!, g0, mid[k]!] })
    // The two half facets of this span and the girdle points under them.
    const from = o.mains[k]!
    const brk = o.breaks[k]! + (o.breaks[k]! < from ? TAU : 0)
    const to = o.mains[next]! + (next === 0 ? TAU : 0)
    for (const [phi0, phi1, a, b] of [[from, brk, g0, gb], [brk, to, gb, g1]] as const) {
      const plane = planeThrough(mid[k]!, a, b)
      // The first point is the shared corner itself (bit for bit, so facets weld exactly).
      const edge: Vec3[] = [a]
      for (let m = 1; m < steps; m++) {
        const q = outlinePoint(o, phi0 + ((phi1 - phi0) * m) / steps)
        const onPlane = Math.abs(plane.n[2]) < 1e-9 ? girdleZ : heightOn(plane, q)
        const bite = Math.max(0, crown ? girdleZ - onPlane : onPlane - girdleZ)
        dip = Math.max(dip, bite)
        edge.push([q[0], q[1], girdleZ + (crown ? -1 : 1) * Math.min(bite, maxDip)])
      }
      ring.push(...edge)
      facets.push({ kind: crown ? 'upperGirdle' : 'lowerGirdle', points: [mid[k]!, ...edge, b] })
    }
  }
  if (apexScale > 0) facets.push({ kind: 'table', points: apex })
  return { ring, facets, dip }
}

/** Table, stars, kites, upper and lower girdle facets, pavilion mains and a faceted girdle. */
export function brilliantFacets(o: Outline, cut: GemCut, options: BrilliantOptions): Faceted {
  const build = (levels: Levels, maxDip: number) => ({
    crown: brilliantHalf(o, cut.tablePct, levels.girdleTop, levels.table, STAR_LENGTH, options.girdleSteps, maxDip),
    // `reach` is measured from the apex: lower halves that run 77 % up from the girdle stop
    // 23 % short of the culet.
    pavilion: brilliantHalf(o, 0, levels.girdleBottom, levels.culet, 1 - LOWER_HALF_LENGTH, options.girdleSteps, maxDip),
  })
  // Where the outline curves strongly the half facets bite deeper into the girdle. Thicken the
  // girdle (to at most twice nominal) so 40 % of it remains at the thinnest place, and flatten
  // whatever would still bite deeper — only a heart's cleft does.
  const probe = build(levelsOf(cut), Infinity)
  const thickness = Math.min(2 * cut.girdlePct, Math.max(cut.girdlePct, (probe.crown.dip + probe.pavilion.dip) / 0.6))
  const levels = levelsOf(cut, thickness)
  const halves = build(levels, 0.3 * thickness)
  const { crown, pavilion } = halves
  const girdle: Facet[] = crown.ring.map((top, i) => {
    const j = (i + 1) % crown.ring.length
    return { kind: 'girdle', points: [top, pavilion.ring[i]!, pavilion.ring[j]!, crown.ring[j]!] }
  })
  return {
    facets: [...crown.facets, ...girdle, ...pavilion.facets],
    stack: [
      { z: levels.culet, scale: 0 },
      { z: levels.girdleBottom, scale: 1 },
      { z: levels.girdleTop, scale: 1 },
      { z: levels.table, scale: cut.tablePct },
    ],
    keel: 0,
  }
}

/**
 * Step cut: three tiers of crown steps and three of pavilion steps between similar polygons.
 * The tiers shrink toward the keel (a line along the length; a point for square stones), which
 * keeps corresponding edges parallel — so every step is a planar trapezoid.
 */
export function stepFacets(o: Outline, cut: GemCut): Faceted {
  const levels = levelsOf(cut)
  const keel = (o.length - 1) / 2
  // Polygon vertices: the outline's corners, in angular order.
  const base = o.corners.map((phi) => outlinePoint(o, phi))
  const tier = (s: number, z: number): Vec3[] =>
    base.map(([x, y]) => {
      const anchor = Math.min(keel, Math.max(-keel, y))
      return [x * s, anchor + (y - anchor) * s, z]
    })
  const crownHeight = levels.table - levels.girdleTop
  const pavilionDepth = levels.girdleBottom - levels.culet
  // Steps are steepest at the girdle and flatten toward table and keel, as on a real stone.
  const t = cut.tablePct
  const crownTiers: StackLevel[] = [
    { z: levels.girdleTop, scale: 1 },
    { z: levels.girdleTop + crownHeight * 0.45, scale: 1 - (1 - t) / 3 },
    { z: levels.girdleTop + crownHeight * 0.8, scale: 1 - ((1 - t) * 2) / 3 },
    { z: levels.table, scale: t },
  ]
  const pavilionTiers: StackLevel[] = [
    { z: levels.girdleBottom, scale: 1 },
    { z: levels.girdleBottom - pavilionDepth * 0.5, scale: 0.64 },
    { z: levels.girdleBottom - pavilionDepth * 0.82, scale: 0.3 },
    { z: levels.culet, scale: 0 },
  ]
  const crown = crownTiers.map((l) => tier(l.scale, l.z))
  const pavilion = pavilionTiers.map((l) => tier(l.scale, l.z))
  const facets: Facet[] = [{ kind: 'table', points: crown[3]! }]
  const band = (kind: FacetKind, a: Vec3[], b: Vec3[]) =>
    a.forEach((p, i) => {
      const j = (i + 1) % a.length
      facets.push({ kind, points: [p, a[j]!, b[j]!, b[i]!] })
    })
  for (let i = 0; i < 3; i++) band('crownStep', crown[i]!, crown[i + 1]!)
  band('girdle', pavilion[0]!, crown[0]!)
  for (let i = 0; i < 3; i++) band('pavilionStep', pavilion[i + 1]!, pavilion[i]!)
  return { facets, stack: [...pavilionTiers.reverse(), ...crownTiers], keel }
}
