/**
 * Which triangles of a host body a pavé field covers, and where that region ends.
 *
 * The region is a triangle label: everything, or triangles facing a direction within an angle,
 * optionally restricted to the inner field an outline body publishes (its front face inside the
 * raised border). Its boundary — label changes, open edges, and creases sharper than 30° inside
 * the region (docs/research/06-freeform.md §5 step 1) — becomes a set of segments; the distance
 * to them is the margin every stone keeps.
 */
import {
  DEG,
  invertSimilarity,
  type Mat4,
  transformPoint,
  uniformScaleOf,
  type Vec3,
} from '../../geometry/vec'
import type { IndexedTriangles } from '../../solid/meshing'
import { type ClosestHit, TriangleBvh } from '../bvh'
import { PointGrid } from '../grid'
import { OutlineDistance } from '../outline/distance'
import type { Contour } from '../outline/svgPath'
import { edgeTopology } from '../topology'

/** The part of an outline body's face that pavé should cover, published in its `data`. */
export interface PaveField {
  /** Closed contours in the body's local XZ plane (x, z), mm. */
  outline: Contour[]
  /** Width of the raised rim around the field, mm: metal that walls in the outer seats. */
  rim?: number
}

/**
 * Faces of a body that are inside the piece or against the skin, published in its `data` so no
 * pavé region ever covers them: the walls of a hollow's cavity (and its escape holes), and a
 * flat back. Stones there would be counted, weighed and seated from inside the metal.
 */
export interface HiddenSurfaces {
  /** The surface the cavity was cut with, in the body's local space. */
  cavity?: IndexedTriangles
  /** A face within this distance of the cavity surface lies on it (mm, local). */
  within: number
  /** The flat back: faces on this local plane y = back that face +Y. */
  back?: number
}

/** Hidden surfaces tied to the world placement of the body that published them. */
export interface PlacedHidden {
  hidden: HiddenSurfaces
  /** Host node matrix: local → world. */
  matrix: Mat4
}

export type RegionSpec = { type: 'all' } | { type: 'facing'; direction: Vec3; maxAngle: number }

/** A published field, already tied to the world placement of the body that published it. */
export interface PlacedField {
  field: PaveField
  /** Host node matrix: local → world. */
  matrix: Mat4
}

const CREASE = 30 * DEG
/**
 * Triangles smaller than this share of the resolution, squared, are slivers and specks left by
 * booleans and edge collapses. Their normals are noise, so they carry no label of their own and
 * make no creases.
 */
const SPECK = 0.15

export interface Region {
  /** 1 for triangles in the region. */
  inside: Uint8Array
  /** Face normals (unit) per triangle. */
  normals: Float64Array
  areas: Float64Array
  area: number
  /** Distance from a point to the region's edge, or the cap given to `selectRegion` if farther. */
  edgeDistance(p: Vec3): number
}

/**
 * `resolution` is the spacing at which boundary segments are indexed (about half the smallest
 * stone is plenty for margins of a few tenths of a millimetre); edge distances are exact up to
 * `edgeCap` and capped beyond it, which keeps every query local.
 */
export function selectRegion(
  mesh: IndexedTriangles,
  spec: RegionSpec,
  placed: PlacedField | null,
  resolution: number,
  edgeCap: number,
  hidden: PlacedHidden | null = null,
): Region {
  const { positions: p, indices } = mesh
  const triangles = indices.length / 3
  const normals = new Float64Array(triangles * 3)
  const areas = new Float64Array(triangles)
  const centroids = new Float64Array(triangles * 3)
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3]! * 3
    const b = indices[t * 3 + 1]! * 3
    const c = indices[t * 3 + 2]! * 3
    const ux = p[b]! - p[a]!
    const uy = p[b + 1]! - p[a + 1]!
    const uz = p[b + 2]! - p[a + 2]!
    const vx = p[c]! - p[a]!
    const vy = p[c + 1]! - p[a + 1]!
    const vz = p[c + 2]! - p[a + 2]!
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    areas[t] = len / 2
    if (len > 0) {
      normals[t * 3] = nx / len
      normals[t * 3 + 1] = ny / len
      normals[t * 3 + 2] = nz / len
    }
    for (let k = 0; k < 3; k++) centroids[t * 3 + k] = (p[a + k]! + p[b + k]! + p[c + k]!) / 3
  }

  const { twin } = edgeTopology(mesh)
  const speck = (SPECK * resolution) ** 2
  const inside = new Uint8Array(triangles)
  const cosMax = spec.type === 'facing' ? Math.cos(spec.maxAngle * DEG) : -2
  const dir = spec.type === 'facing' ? unit(spec.direction) : ([0, 0, 0] as Vec3)
  const field = placed ? new FieldTest(placed) : null
  const hide = hidden ? new HiddenTest(hidden) : null
  const specks: number[] = []
  for (let t = 0; t < triangles; t++) {
    const centroid: Vec3 = [centroids[t * 3]!, centroids[t * 3 + 1]!, centroids[t * 3 + 2]!]
    const n: Vec3 = [normals[t * 3]!, normals[t * 3 + 1]!, normals[t * 3 + 2]!]
    // Hidden faces are out whatever their size, so a cavity's specks cannot pull it back in.
    if (hide?.covers(centroid, n)) continue
    if (areas[t]! < speck) {
      specks.push(t)
      continue
    }
    const facing = spec.type === 'all' || n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] >= cosMax
    inside[t] = facing && (!field || field.covers(centroid, n)) ? 1 : 0
  }
  // Specks take the label of their labelled neighbours (a few passes reach clusters of them):
  // the label they share the most edge length with. A sliver of an extruded face's fan has two
  // long edges inside the face and a short one on its outline; taking the first neighbour found
  // could take the outline's wall, and the sliver's long edges then cut a false edge right
  // across the field, which stones keep their margin from.
  const resolved = new Uint8Array(triangles).fill(1)
  for (const t of specks) resolved[t] = 0
  const edgeLength = (h: number) => {
    const a = indices[h]! * 3
    const b = indices[h - (h % 3) + ((h + 1) % 3)]! * 3
    return Math.hypot(p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!)
  }
  for (let pass = 0; pass < 4; pass++)
    for (const t of specks) {
      if (resolved[t]) continue
      const shared = [0, 0]
      for (let k = 0; k < 3; k++) {
        const o = twin[t * 3 + k]!
        if (o < 0 || !resolved[(o / 3) | 0]) continue
        shared[inside[(o / 3) | 0]!]! += edgeLength(t * 3 + k)
      }
      if (shared[0] === 0 && shared[1] === 0) continue
      inside[t] = shared[1]! > shared[0]! ? 1 : 0
      resolved[t] = 1
    }

  // Boundary segments: open edges, label changes, and creases within the region.
  const cosCrease = Math.cos(CREASE)
  const segments: number[] = []
  for (let h = 0; h < indices.length; h++) {
    const t = (h / 3) | 0
    if (!inside[t]) continue
    const o = twin[h]!
    const other = o < 0 ? -1 : (o / 3) | 0
    // Open edges and label changes always bound the region, specks or not (a gap in the
    // boundary lets stones into the margin). Between two triangles of the region only a crease
    // does, and specks, whose normals are noise, make none.
    if (other >= 0 && inside[other]) {
      // Each interior edge is visited from both sides; judge it once.
      if (other < t || areas[t]! < speck || areas[other]! < speck) continue
      const cos =
        normals[t * 3]! * normals[other * 3]! +
        normals[t * 3 + 1]! * normals[other * 3 + 1]! +
        normals[t * 3 + 2]! * normals[other * 3 + 2]!
      if (cos >= cosCrease) continue
    }
    const a = indices[h]!
    const b = indices[h - (h % 3) + ((h + 1) % 3)]!
    segments.push(p[a * 3]!, p[a * 3 + 1]!, p[a * 3 + 2]!, p[b * 3]!, p[b * 3 + 1]!, p[b * 3 + 2]!)
  }

  let area = 0
  for (let t = 0; t < triangles; t++) if (inside[t]) area += areas[t]!
  const edges = new SegmentDistance(segments, resolution, edgeCap)
  return {
    inside,
    normals,
    areas,
    area,
    edgeDistance: (q) =>
      Math.min(edges.distance(q), field ? field.edgeDistance(q, edgeCap) : edgeCap),
  }
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Membership in, and distance to the edge of, a field given in its body's local XZ plane. */
class FieldTest {
  private readonly toLocal: Mat4
  private readonly scale: number
  private readonly outline: OutlineDistance
  private readonly front: Vec3

  constructor({ field, matrix }: PlacedField) {
    this.toLocal = invertSimilarity(matrix)
    this.scale = uniformScaleOf(matrix)
    this.outline = new OutlineDistance(field.outline)
    // Outline bodies face −Y locally.
    const m = matrix
    this.front = unit([-m[4]!, -m[5]!, -m[6]!])
  }

  /** On the front of the body and inside the field. */
  covers(p: Vec3, n: Vec3): boolean {
    if (n[0] * this.front[0] + n[1] * this.front[1] + n[2] * this.front[2] < 0.2) return false
    const q = transformPoint(this.toLocal, p)
    return this.outline.inside(q[0], q[2])
  }

  edgeDistance(p: Vec3, cap: number): number {
    const q = transformPoint(this.toLocal, p)
    return this.outline.distance(q[0], q[2], cap / this.scale) * this.scale
  }
}

/**
 * Distance from a world point to the cavity a host publishes, up to `cap` (returned when the
 * cavity is farther, or when there is none). Seats and drill holes keep their metal to it: a
 * hole that grazes a cavity corner leaves a tunnel the investment cannot fill.
 */
export function cavityDistance(
  placed: PlacedHidden | null,
): ((p: Vec3, cap: number) => number) | null {
  if (!placed?.hidden.cavity || placed.hidden.cavity.indices.length === 0) return null
  const toLocal = invertSimilarity(placed.matrix)
  const scale = uniformScaleOf(placed.matrix)
  const bvh = new TriangleBvh(placed.hidden.cavity)
  const hit: ClosestHit = { d2: 0, x: 0, y: 0, z: 0, triangle: -1 }
  return (p, cap) => {
    const q = transformPoint(toLocal, p)
    return bvh.closest(q[0], q[1], q[2], hit, cap / scale) ? Math.sqrt(hit.d2) * scale : cap
  }
}

/** Whether a face of the host lies on its published cavity or flat back. */
class HiddenTest {
  private readonly toLocal: Mat4
  private readonly within: number
  private readonly bvh: TriangleBvh | null
  private readonly back: number | undefined
  private readonly backNormal: Vec3
  private readonly hit: ClosestHit = { d2: 0, x: 0, y: 0, z: 0, triangle: -1 }

  constructor({ hidden, matrix }: PlacedHidden) {
    this.toLocal = invertSimilarity(matrix)
    this.within = hidden.within
    this.bvh =
      hidden.cavity && hidden.cavity.indices.length > 0 ? new TriangleBvh(hidden.cavity) : null
    this.back = hidden.back
    const m = matrix
    this.backNormal = unit([m[4]!, m[5]!, m[6]!])
  }

  covers(p: Vec3, n: Vec3): boolean {
    const q = transformPoint(this.toLocal, p)
    if (
      this.back !== undefined &&
      Math.abs(q[1] - this.back) < 1e-3 &&
      n[0] * this.backNormal[0] + n[1] * this.backNormal[1] + n[2] * this.backNormal[2] > 0.9
    )
      return true
    return this.bvh?.closest(q[0], q[1], q[2], this.hit, this.within) ?? false
  }
}

/** Euclidean distance to a set of 3D segments (a geodesic proxy, conservative: it never exceeds it). */
class SegmentDistance {
  private readonly grid: PointGrid | null
  private readonly cell: number
  private readonly segs: Float64Array
  /** Grid point → segment index. */
  private readonly owner: number[] = []

  constructor(
    segments: number[],
    resolution: number,
    private readonly cap: number,
  ) {
    this.segs = Float64Array.from(segments)
    const n = segments.length / 6
    this.cell = resolution
    if (n === 0) {
      this.grid = null
      return
    }
    // Segments are indexed by points every `cell` along them, so any segment within D of a
    // query has an indexed point within D + cell / 2. Grid cells match the query radius.
    this.grid = new PointGrid(cap + resolution)
    for (let s = 0; s < n; s++) {
      const steps = Math.max(1, Math.ceil(this.length(s) / this.cell))
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const o = s * 6
        this.grid.add(
          this.segs[o]! + (this.segs[o + 3]! - this.segs[o]!) * t,
          this.segs[o + 1]! + (this.segs[o + 4]! - this.segs[o + 1]!) * t,
          this.segs[o + 2]! + (this.segs[o + 5]! - this.segs[o + 2]!) * t,
        )
        this.owner.push(s)
      }
    }
  }

  private length(s: number): number {
    const o = s * 6
    return Math.hypot(
      this.segs[o + 3]! - this.segs[o]!,
      this.segs[o + 4]! - this.segs[o + 1]!,
      this.segs[o + 5]! - this.segs[o + 2]!,
    )
  }

  /** Distance to the nearest segment, or the cap when none is nearer. */
  distance(q: Vec3): number {
    const cap = this.cap
    if (!this.grid) return cap
    let best = cap
    const checked = new Set<number>()
    // Every segment nearer than `cap` has an indexed point within cap + cell / 2.
    this.grid.near(q[0], q[1], q[2], cap + this.cell, (i) => {
      const s = this.owner[i]!
      if (checked.has(s)) return
      checked.add(s)
      best = Math.min(best, this.segmentDistance(s, q))
    })
    return best
  }

  private segmentDistance(s: number, q: Vec3): number {
    const o = s * 6
    const ax = this.segs[o]!
    const ay = this.segs[o + 1]!
    const az = this.segs[o + 2]!
    const dx = this.segs[o + 3]! - ax
    const dy = this.segs[o + 4]! - ay
    const dz = this.segs[o + 5]! - az
    const len2 = dx * dx + dy * dy + dz * dz
    const t =
      len2 > 0
        ? Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy + (q[2] - az) * dz) / len2))
        : 0
    return Math.hypot(q[0] - ax - t * dx, q[1] - ay - t * dy, q[2] - az - t * dz)
  }
}
