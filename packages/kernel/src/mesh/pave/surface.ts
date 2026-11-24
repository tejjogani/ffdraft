/**
 * The host surface as pavé sees it: a dense, even sampling of the region, each sample carrying
 * a footprint-smoothed normal, curvature, the distance to the region's edge and (on demand) the
 * local metal thickness under it (docs/research/06-freeform.md §5 step 1).
 *
 * Sampling instead of working on the host's vertices makes every field independent of how the
 * body happens to be triangulated: an extruded letter's face is a few long slivers, an AI mesh a
 * million noisy triangles, and both are sampled at the same ~¼-stone spacing.
 */
import { dot, scale, sub, type Vec3 } from '../../geometry/vec'
import type { IndexedTriangles } from '../../solid/meshing'
import { TriangleBvh } from '../bvh'
import { StaticPointGrid } from '../grid'
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

  /** Visits samples within `radius` of a point. */
  near(q: Vec3, radius: number, visit: (index: number, d2: number) => void): void {
    this.grid.near(q[0], q[1], q[2], radius, visit)
  }

  /** Metal thickness straight in from sample i (first wall hit along −normal), mm. */
  thickness(i: number): number {
    let t = this.thicknessCache[i]!
    if (t < 0) {
      const [x, y, z] = this.point(i)
      const [nx, ny, nz] = this.normal(i)
      const lift = this.spacing * 0.05
      this.bvh ??= new TriangleBvh(this.host)
      t =
        this.bvh.raycast(x + nx * lift, y + ny * lift, z + nz * lift, -nx, -ny, -nz, lift * 4) -
        lift
      this.thicknessCache[i] = t
    }
    return t
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

  /** κ ≈ (nⱼ − nᵢ)·(pⱼ − pᵢ) / |pⱼ − pᵢ|² over neighbours; positive where the surface is convex. */
  private measureCurvature(radius: number): void {
    const p = this.p
    const n = this.n
    const minD2 = (radius * 0.4) ** 2
    for (let i = 0; i < this.count; i++) {
      let convex = 0
      let concave = 0
      this.grid.near(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!, radius, (j, d2) => {
        if (d2 < minD2) return
        let k = 0
        for (let c = 0; c < 3; c++)
          k += (n[j * 3 + c]! - n[i * 3 + c]!) * (p[j * 3 + c]! - p[i * 3 + c]!)
        k /= d2
        if (k > convex) convex = k
        if (-k > concave) concave = -k
      })
      this.convex[i] = convex
      this.concave[i] = concave
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

/** Binary min-heap of (index, key) pairs. */
class MinHeap {
  private keys: number[] = []
  private items: number[] = []

  get size(): number {
    return this.items.length
  }

  push(item: number, key: number): void {
    this.items.push(item)
    this.keys.push(key)
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.keys[parent]! <= this.keys[i]!) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.items[0]!, this.keys[0]!]
    const last = this.items.length - 1
    this.swap(0, last)
    this.items.pop()
    this.keys.pop()
    let i = 0
    for (;;) {
      const l = i * 2 + 1
      const r = l + 1
      let m = i
      if (l < this.items.length && this.keys[l]! < this.keys[m]!) m = l
      if (r < this.items.length && this.keys[r]! < this.keys[m]!) m = r
      if (m === i) break
      this.swap(i, m)
      i = m
    }
    return top
  }

  private swap(a: number, b: number): void {
    ;[this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!]
    ;[this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!]
  }
}
