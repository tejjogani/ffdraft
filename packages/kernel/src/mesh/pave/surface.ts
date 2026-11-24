/**
 * The host surface as pavé sees it: a dense, even sampling of the region, each sample carrying
 * a footprint-smoothed normal, curvature, the distance to the region's edge and (on demand) the
 * local metal thickness under it (docs/research/06-freeform.md §5 step 1).
 *
 * Sampling instead of working on the host's vertices makes every field independent of how the
 * body happens to be triangulated: an extruded letter's face is a few long slivers, an AI mesh a
 * million noisy triangles, and both are sampled at the same ~¼-stone spacing.
 */
import { cross, dot, normalize, scale, sub, type Vec3 } from '../../geometry/vec'
import type { IndexedTriangles } from '../../solid/meshing'
import { TriangleBvh } from '../bvh'
import { StaticPointGrid } from '../grid'
import { MinHeap } from '../heap'
import { seededRandom } from '../random'
import type { Region } from './region'

export interface SurfaceOptions {
  /** Target distance between samples, mm. */
  spacing: number
  /** Radius over which normals are averaged (about a stone radius). */
  normalRadius: number
  /** The cap the region's edge distances were computed with, mm. */
  edgeCap: number
}

/** Samples beyond this are thinned by widening the spacing (keeps memory and time bounded). */
const MAX_SAMPLES = 250_000
/** Neighbours whose normals differ by more than this are across a crease and not averaged. */
const SMOOTH_COS = Math.cos((30 * Math.PI) / 180)
/** Fixed so the sampling (and thus the fields) never depends on the user's layout seed. */
const SAMPLING_SEED = 0x5eed

export class PaveSurface {
  readonly count: number
  readonly spacing: number
  readonly p: Float64Array
  readonly n: Float64Array
  /** Exact distance to the region edge, capped at `edgeCap`. */
  readonly edge: Float64Array
  /** Approximate geodesic distance to the region edge (multi-source Dijkstra), uncapped. */
  readonly depth: Float64Array
  /** Largest convex and concave normal curvature around each sample, 1/mm. */
  readonly convex: Float64Array
  readonly concave: Float64Array
  private readonly grid: StaticPointGrid
  private bvh: TriangleBvh | null = null
  private readonly thicknessCache: Float64Array
  private readonly host: IndexedTriangles
  /** Region label per host triangle. */
  private readonly inside: Uint8Array
  /** Face normals per host triangle. */
  private readonly faceNormals: Float64Array

  constructor(host: IndexedTriangles, region: Region, options: SurfaceOptions) {
    this.spacing = Math.max(options.spacing, Math.sqrt(region.area / MAX_SAMPLES))
    const h = this.spacing
    const positions: number[] = []
    const faceNormals: number[] = []
    const random = seededRandom(SAMPLING_SEED)
    const { positions: v, indices } = host
    for (let t = 0; t < region.inside.length; t++) {
      if (!region.inside[t]) continue
      const count = Math.floor(region.areas[t]! / (h * h) + random())
      const a = indices[t * 3]! * 3
      const b = indices[t * 3 + 1]! * 3
      const c = indices[t * 3 + 2]! * 3
      for (let i = 0; i < count; i++) {
        // Uniform point in a triangle (Osada et al. 2002).
        const r1 = Math.sqrt(random())
        const r2 = random()
        const wa = 1 - r1
        const wb = r1 * (1 - r2)
        const wc = r1 * r2
        for (let k = 0; k < 3; k++) positions.push(wa * v[a + k]! + wb * v[b + k]! + wc * v[c + k]!)
        for (let k = 0; k < 3; k++) faceNormals.push(region.normals[t * 3 + k]!)
      }
    }
    this.count = positions.length / 3
    this.p = Float64Array.from(positions)
    this.grid = new StaticPointGrid(this.p, h * 2.5)
    this.n = this.smoothNormals(Float64Array.from(faceNormals), options.normalRadius)
    this.convex = new Float64Array(this.count)
    this.concave = new Float64Array(this.count)
    this.measureCurvature(Math.max(options.normalRadius, 3 * h))
    this.edge = new Float64Array(this.count)
    for (let i = 0; i < this.count; i++) this.edge[i] = region.edgeDistance(this.point(i))
    this.depth = this.geodesicDepth(options.edgeCap)
    this.host = host
    this.inside = region.inside
    this.faceNormals = region.normals
    this.thicknessCache = new Float64Array(this.count).fill(-1)
  }

  point(i: number): Vec3 {
    return [this.p[i * 3]!, this.p[i * 3 + 1]!, this.p[i * 3 + 2]!]
  }

  normal(i: number): Vec3 {
    return [this.n[i * 3]!, this.n[i * 3 + 1]!, this.n[i * 3 + 2]!]
  }

  /** The sample nearest to a point, if one is within ~2.5 sample spacings (i.e. on the region). */
  nearest(q: Vec3): number {
    return this.grid.nearest(q[0], q[1], q[2], this.spacing * 2.5)
  }

  /** The point of the region's surface nearest to q (via the nearest sample's tangent plane), or null off the region. */
  snap(q: Vec3): { sample: number; p: Vec3; n: Vec3 } | null {
    const s = this.nearest(q)
    if (s < 0) return null
    const ps = this.point(s)
    const n = this.normal(s)
    return { sample: s, p: sub(q, scale(n, dot(sub(q, ps), n))), n }
  }

  /**
   * Like {@link snap}, but onto the host's actual triangles: a tangent plane lies off a curved
   * surface (by d²/2R at d from its sample), which a stone's seat absorbs but a 0.3 mm bead,
   * which must sink into the metal to hold, does not.
   */
  snapExact(q: Vec3): { sample: number; p: Vec3; n: Vec3 } | null {
    const hit = this.snap(q)
    if (!hit) return null
    this.bvh ??= new TriangleBvh(this.host)
    const closest = { d2: 0, x: 0, y: 0, z: 0, triangle: -1 }
    if (!this.bvh.closest(hit.p[0], hit.p[1], hit.p[2], closest, 2.5 * this.spacing)) return hit
    return { ...hit, p: [closest.x, closest.y, closest.z] }
  }

  /** Visits samples within `radius` of a point. */
  near(q: Vec3, radius: number, visit: (index: number, d2: number) => void): void {
    this.grid.near(q[0], q[1], q[2], radius, visit)
  }

  /**
   * Metal depth available to a seat at sample i: the thickness straight in (to the first wall
   * hit along −normal), or half of it when that wall is itself in the region — its own stones
   * are seated from the other side, so a thin plate paved on both faces shares its metal.
   */
  thickness(i: number): number {
    let t = this.thicknessCache[i]!
    if (t < 0) {
      const [x, y, z] = this.point(i)
      const [nx, ny, nz] = this.normal(i)
      const lift = this.spacing * 0.05
      this.bvh ??= new TriangleBvh(this.host)
      const hit = this.bvh.firstHit(
        x + nx * lift,
        y + ny * lift,
        z + nz * lift,
        -nx,
        -ny,
        -nz,
        lift * 4,
      )
      t = (hit.t - lift) * (hit.triangle >= 0 && this.inside[hit.triangle] ? 0.5 : 1)
      this.thicknessCache[i] = t
    }
    return t
  }

  /**
   * Metal along the unit ray o + t·d, which starts outside the body: from where it enters to
   * where it next leaves, halved when it leaves through the region (that wall is seated from
   * its own side too, as in {@link thickness}). 0 when the ray misses the body or starts inside
   * it — metal above a seat's rim is as much a clash as none below it.
   */
  metalAlong(o: Vec3, d: Vec3): number {
    this.bvh ??= new TriangleBvh(this.host)
    const entry = this.bvh.firstHit(o[0], o[1], o[2], d[0], d[1], d[2])
    if (entry.triangle < 0 || this.facing(entry.triangle, d) >= 0) return 0
    const exit = this.bvh.firstHit(
      o[0],
      o[1],
      o[2],
      d[0],
      d[1],
      d[2],
      entry.t + 1e-6,
      Infinity,
      entry.triangle,
    )
    if (exit.triangle < 0) return 0
    return (exit.t - entry.t) * (this.inside[exit.triangle] ? 0.5 : 1)
  }

  /** Cosine between a host triangle's outward normal and a direction. */
  private facing(triangle: number, d: Vec3): number {
    const n = this.faceNormals
    return n[triangle * 3]! * d[0] + n[triangle * 3 + 1]! * d[1] + n[triangle * 3 + 2]! * d[2]
  }

  private smoothNormals(face: Float64Array, radius: number): Float64Array {
    const out = new Float64Array(face.length)
    for (let i = 0; i < this.count; i++) {
      let x = 0
      let y = 0
      let z = 0
      this.grid.near(this.p[i * 3]!, this.p[i * 3 + 1]!, this.p[i * 3 + 2]!, radius, (j, d2) => {
        const agree =
          face[i * 3]! * face[j * 3]! +
          face[i * 3 + 1]! * face[j * 3 + 1]! +
          face[i * 3 + 2]! * face[j * 3 + 2]!
        if (agree < SMOOTH_COS) return
        // A soft kernel so the average follows the footprint, not its rim.
        const w = 1 - d2 / (radius * radius)
        x += face[j * 3]! * w
        y += face[j * 3 + 1]! * w
        z += face[j * 3 + 2]! * w
      })
      const l = Math.hypot(x, y, z) || 1
      out[i * 3] = x / l
      out[i * 3 + 1] = y / l
      out[i * 3 + 2] = z / l
    }
    return out
  }

  /**
   * Principal curvatures from normal curvatures: every neighbour j gives κⱼ ≈ (nⱼ − nᵢ)·(pⱼ − pᵢ)
   * / |pⱼ − pᵢ|² along its tangent direction θⱼ, and Euler's theorem κ(θ) = a cos²θ + 2b cosθ sinθ
   * + c sin²θ is fitted to them by least squares. Taking the largest single κⱼ instead lets one
   * noisy facet normal shrink the stones around it; the fit averages that noise away.
   */
  private measureCurvature(radius: number): void {
    const p = this.p
    const n = this.n
    const minD2 = (radius * 0.4) ** 2
    // Normal equations of the 3-parameter fit, accumulated per sample.
    const m = new Float64Array(9)
    const r = new Float64Array(3)
    for (let i = 0; i < this.count; i++) {
      const normal = this.normal(i)
      const e1 = tangentOf(normal)
      const e2 = cross(normal, e1)
      m.fill(0)
      r.fill(0)
      let samples = 0
      this.grid.near(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!, radius, (j, d2) => {
        if (d2 < minD2) return
        let k = 0
        let u = 0
        let v = 0
        for (let c = 0; c < 3; c++) {
          const dp = p[j * 3 + c]! - p[i * 3 + c]!
          k += (n[j * 3 + c]! - n[i * 3 + c]!) * dp
          u += dp * e1[c]!
          v += dp * e2[c]!
        }
        const t2 = u * u + v * v
        if (t2 < 1e-18) return
        const row = [(u * u) / t2, (2 * u * v) / t2, (v * v) / t2]
        k /= d2
        for (let a = 0; a < 3; a++) {
          r[a] = r[a]! + row[a]! * k
          for (let b = 0; b < 3; b++) m[a * 3 + b] = m[a * 3 + b]! + row[a]! * row[b]!
        }
        samples++
      })
      const fit = samples >= 6 ? solve3(m, r) : null
      if (!fit) continue
      const [a, b, c] = fit
      // Eigenvalues of the symmetric form [[a, b], [b, c]]: the principal curvatures.
      const mean = (a + c) / 2
      const spread = Math.hypot((a - c) / 2, b)
      this.convex[i] = Math.max(0, mean + spread)
      this.concave[i] = Math.max(0, spread - mean)
    }
  }

  /**
   * Distance to the edge measured through the surface: Dijkstra over sample neighbours, seeded
   * by the samples whose exact edge distance is below the cap. Used to order stones from the
   * heart of the region outward; regions without an edge get a uniform depth.
   */
  private geodesicDepth(cap: number): Float64Array {
    const depth = new Float64Array(this.count).fill(Infinity)
    const heap = new MinHeap()
    for (let i = 0; i < this.count; i++)
      if (this.edge[i]! < cap) {
        depth[i] = this.edge[i]!
        heap.push(i, depth[i]!)
      }
    const reach = this.spacing * 1.8
    while (heap.size > 0) {
      const [i, d] = heap.pop()
      if (d > depth[i]!) continue
      this.grid.near(this.p[i * 3]!, this.p[i * 3 + 1]!, this.p[i * 3 + 2]!, reach, (j, d2) => {
        const nd = d + Math.sqrt(d2)
        if (nd < depth[j]!) {
          depth[j] = nd
          heap.push(j, nd)
        }
      })
    }
    for (let i = 0; i < this.count; i++) if (depth[i] === Infinity) depth[i] = cap
    return depth
  }
}

/** A unit tangent of a unit normal (any one; the curvature fit does not depend on which). */
function tangentOf(n: Vec3): Vec3 {
  return normalize(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]))
}

/** Solves the 3×3 system m·x = r (row-major) by Cramer's rule, or null when singular. */
function solve3(m: Float64Array, r: Float64Array): [number, number, number] | null {
  const det = (a: ArrayLike<number>) =>
    a[0]! * (a[4]! * a[8]! - a[5]! * a[7]!) -
    a[1]! * (a[3]! * a[8]! - a[5]! * a[6]!) +
    a[2]! * (a[3]! * a[7]! - a[4]! * a[6]!)
  const d = det(m)
  if (Math.abs(d) < 1e-12) return null
  const out: [number, number, number] = [0, 0, 0]
  for (let col = 0; col < 3; col++) {
    const a = Float64Array.from(m)
    for (let row = 0; row < 3; row++) a[row * 3 + col] = r[row]!
    out[col] = det(a) / d
  }
  return out
}
