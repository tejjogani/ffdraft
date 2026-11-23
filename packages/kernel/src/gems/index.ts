/**
 * Unit gem meshes: girdle width = 1, table toward +z, girdle plane at z = 0, length along y.
 * One mesh per (cut, length:width) is shared by every stone of that shape; a stone's matrix
 * scales it to its real dimensions.
 */
import { GEM_CUTS, type GemCut, type GemCutId } from '@pave/schema'
import { type Vec3, cross, dot, sub } from '../geometry/vec'
import type { MeshData } from '../types'
import { type Facet, type FacetKind, type Faceted, type StackLevel, brilliantFacets, levelsOf, stepFacets } from './facets'
import type { Loop } from '../geometry/loop'
import { type Outline, outlineFor, outlineLoop, outlinePoint } from './outline'

export interface GemUnit {
  /** `${cut}@${ratio}` — the key into `Evaluation.gemMeshes`. */
  key: string
  cut: GemCutId
  mesh: MeshData
  /** Planar facets (empty for cabochons, whose dome is smooth). */
  facets: readonly Facet[]
  outline: Outline
  /** Girdle length for a girdle width of 1. */
  length: number
  /** Table height above and culet depth below the girdle plane (bottom is negative). */
  top: number
  bottom: number
  /** top − bottom. */
  depth: number
  /** The silhouette, culet to table: the outline scaled by `scale` at height `z`. */
  stack: readonly StackLevel[]
  /** Half-length of the keel the silhouette shrinks toward (step cuts), else 0. */
  keel: number
}

const cache = new Map<string, GemUnit>()

/**
 * The length:width ratio a cut actually uses for a requested ratio: clamped to what the cut
 * allows. The schema fills in 1 when no ratio was given, which no elongated cut allows — that
 * case gets the cut's own default (an oval is 1.4, not its 1.2 minimum).
 */
export function gemRatio(cut: GemCutId, lw: number | undefined): number {
  const c: GemCut = GEM_CUTS[cut]
  const requested = lw === undefined || (lw === 1 && c.lw.min > 1) ? c.lw.default : lw
  return Math.min(c.lw.max, Math.max(c.lw.min, requested))
}

export function gemUnit(cutId: GemCutId, lw?: number): GemUnit {
  // Meshes are shared per 1 % step of the ratio; the instance matrix absorbs the remainder.
  const ratio = Math.round(gemRatio(cutId, lw) * 100) / 100
  const key = `${cutId}@${ratio}`
  let unit = cache.get(key)
  if (!unit) {
    const cut: GemCut = GEM_CUTS[cutId]
    const outline = outlineFor(cut.outline, ratio, cut.cornerCut)
    const faceted: Faceted =
      cut.style === 'cabochon'
        ? cabochonStack(cut)
        : cut.style === 'step'
          ? stepFacets(outline, cut)
          : brilliantFacets(outline, cut, { girdleSteps: cut.outline === 'round' ? 4 : 6 })
    const { facets } = faceted
    const mesh = cut.style === 'cabochon' ? cabochonMesh(outline, cut) : facetedMesh(facets)
    let top = -Infinity
    let bottom = Infinity
    for (let i = 2; i < mesh.positions.length; i += 3) {
      top = Math.max(top, mesh.positions[i]!)
      bottom = Math.min(bottom, mesh.positions[i]!)
    }
    unit = {
      key,
      cut: cutId,
      mesh,
      facets,
      outline,
      length: ratio,
      top,
      bottom,
      depth: top - bottom,
      stack: faceted.stack,
      keel: faceted.keel,
    }
    cache.set(key, unit)
  }
  return unit
}

/** The unit's outline at a stack level, as a Bézier loop in the unit's own xy-plane. */
export function stackLoop(unit: GemUnit, level: StackLevel): Loop {
  const [cx, cy] = unit.outline.centre
  return outlineLoop(unit.outline).map(
    (segment) =>
      segment.map(([x, y]) => {
        const anchor = cy + Math.min(unit.keel, Math.max(-unit.keel, y - cy))
        return [cx + (x - cx) * level.scale, anchor + (y - anchor) * level.scale] as const
      }) as unknown as Loop[number],
  )
}

/** True when a point (in unit coordinates) lies inside the stone's silhouette. */
export function unitContains(unit: GemUnit, [x, y, z]: readonly [number, number, number]): boolean {
  const { stack } = unit
  if (z <= stack[0]!.z || z >= stack[stack.length - 1]!.z) return false
  let i = 0
  while (stack[i + 1]!.z < z) i++
  const a = stack[i]!
  const b = stack[i + 1]!
  const scale = a.scale + ((b.scale - a.scale) * (z - a.z)) / (b.z - a.z)
  if (scale <= 1e-9) return false
  // Undo the level's scaling, then test against the girdle outline.
  const [cx, cy] = unit.outline.centre
  const anchor = cy + Math.min(unit.keel, Math.max(-unit.keel, y - cy))
  const gx = cx + (x - cx) / scale
  const gy = anchor + (y - anchor) / scale
  const r = Math.hypot(gx - cx, gy - cy)
  return r <= unit.outline.radius(Math.atan2(gy - cy, gx - cx))
}

/** Facet counts by kind, for reports and tests. */
export function facetCounts(unit: GemUnit): Partial<Record<FacetKind, number>> {
  const counts: Partial<Record<FacetKind, number>> = {}
  for (const f of unit.facets) counts[f.kind] = (counts[f.kind] ?? 0) + 1
  return counts
}

/** Newell normal of a polygon (robust for slightly non-planar input). */
function polygonNormal(points: readonly Vec3[]): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!
    x += (p[1] - q[1]) * (p[2] + q[2])
    y += (p[2] - q[2]) * (p[0] + q[0])
    z += (p[0] - q[0]) * (p[1] + q[1])
  })
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}

/** Flat-shaded mesh: every facet gets its own vertices and a single normal. */
function facetedMesh(facets: readonly Facet[]): MeshData {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  // Any point well inside the stone: facets are wound so their normals point away from it.
  const inside: Vec3 = [0, 0, 0]
  for (const facet of facets) {
    // Collapsed tiers repeat points; drop them so no triangle is degenerate.
    const points = facet.points.filter((p, i, all) => {
      const q = all[(i + all.length - 1) % all.length]!
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 1e-9
    })
    if (points.length < 3) continue
    let normal = polygonNormal(points)
    if (dot(normal, sub(points[0]!, inside)) < 0) {
      points.reverse()
      normal = [-normal[0], -normal[1], -normal[2]]
    }
    // Fan from the first vertex — except tables, which can be concave (a heart's cleft) but
    // are star-shaped about their centroid.
    if (facet.kind === 'table')
      points.unshift([0, 1, 2].map((k) => points.reduce((sum, p) => sum + p[k]!, 0) / points.length) as unknown as Vec3, )
    const base = positions.length / 3
    for (const p of points) {
      positions.push(p[0], p[1], p[2])
      normals.push(normal[0], normal[1], normal[2])
    }
    const last = facet.kind === 'table' ? points.length : points.length - 1
    for (let i = 1; i < last; i++) {
      const j = i + 1 < points.length ? i + 1 : 1
      // Skip slivers (collinear girdle points on straight sides).
      const area = cross(sub(points[i]!, points[0]!), sub(points[j]!, points[0]!))
      if (Math.hypot(area[0], area[1], area[2]) > 1e-12) indices.push(base, base + i, base + j)
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  }
}

/** A cabochon's silhouette: a flat base, the girdle band and a few rings of the dome. */
function cabochonStack(cut: GemCut): Faceted {
  const levels = levelsOf(cut)
  const dome = levels.table - levels.girdleTop
  const rings = [0, 30, 55, 75].map((deg) => {
    const a = (deg * Math.PI) / 180
    return { z: levels.girdleTop + dome * Math.sin(a), scale: Math.cos(a) }
  })
  return { facets: [], stack: [{ z: levels.girdleBottom, scale: 1 }, ...rings, { z: levels.table, scale: 0.08 }], keel: 0 }
}

/** A smooth ellipsoidal dome over a girdle band and a flat base. */
function cabochonMesh(o: Outline, cut: GemCut): MeshData {
  const levels = levelsOf(cut)
  const rings = 14
  const around = 64
  const dome = levels.table - levels.girdleTop
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const rim: Vec3[] = []
  for (let j = 0; j < around; j++) {
    const [x, y] = outlinePoint(o, (j / around) * Math.PI * 2)
    rim.push([x, y, 0])
  }
  // Dome rings from the girdle (i = 0) to just below the apex, then the apex itself.
  for (let i = 0; i < rings; i++) {
    const a = (i / rings) * (Math.PI / 2)
    const s = Math.cos(a)
    for (const [x, y] of rim) {
      positions.push(x * s, y * s, levels.girdleTop + dome * Math.sin(a))
      // Gradient of the ellipsoid (x/a)² + (y/b)² + (z/c)² = 1 on an elliptical base.
      const nx = (x * s) / 0.25
      const ny = (y * s) / (o.length / 2) ** 2
      const nz = Math.sin(a) / dome
      const l = Math.hypot(nx, ny, nz)
      normals.push(nx / l, ny / l, nz / l)
    }
  }
  const apex = positions.length / 3
  positions.push(0, 0, levels.table)
  normals.push(0, 0, 1)
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < around; j++) {
      const a = i * around + j
      const b = i * around + ((j + 1) % around)
      if (i + 1 < rings) indices.push(a, b, b + around, a, b + around, a + around)
      else indices.push(a, b, apex)
    }
  // Girdle band (its own vertices: the normal is horizontal) and the flat base.
  const band = positions.length / 3
  rim.forEach(([x, y], j) => {
    const p = rim[(j + around - 1) % around]!
    const q = rim[(j + 1) % around]!
    const l = Math.hypot(q[1] - p[1], q[0] - p[0])
    for (const z of [levels.girdleTop, levels.girdleBottom]) {
      positions.push(x, y, z)
      normals.push((q[1] - p[1]) / l, -(q[0] - p[0]) / l, 0)
    }
  })
  const base = positions.length / 3
  for (const [x, y] of rim) {
    positions.push(x, y, levels.girdleBottom)
    normals.push(0, 0, -1)
  }
  for (let j = 0; j < around; j++) {
    const k = (j + 1) % around
    indices.push(band + j * 2, band + j * 2 + 1, band + k * 2 + 1, band + j * 2, band + k * 2 + 1, band + k * 2)
    if (j > 0 && j + 1 < around) indices.push(base, base + j + 1, base + j)
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  }
}
