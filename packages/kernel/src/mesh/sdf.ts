/**
 * Sampled signed distance to a triangle surface, for `Manifold.levelSet` (re-surfacing broken
 * meshes, inward offsets for hollowing).
 *
 * The distance is computed once on a regular grid and interpolated, because a level set calls
 * its SDF hundreds of thousands of times and a per-call BVH query from JS is far too slow
 * (docs/research/06-freeform.md §4). Inside/outside is the winding number along grid rows
 * (summed signed crossings, so overlapping shells count as inside, where parity would not): one
 * ray serves a whole row, so the sign costs O(rows · log n). Damaged meshes take a majority vote
 * over rows along all three axes, which tolerates holes and stray faces.
 */
import type { Box, Manifold } from 'manifold-3d'
import { runtime } from '../runtime/index'
import type { IndexedTriangles } from '../solid/meshing'
import { type ClosestHit, TriangleBvh } from './bvh'

export interface DistanceGrid {
  origin: readonly [number, number, number]
  spacing: number
  size: readonly [number, number, number]
  /** Positive inside, clamped to ±band. */
  values: Float32Array
  band: number
}

export interface DistanceGridOptions {
  spacing: number
  /** Distances beyond this are clamped (they only need the right sign). */
  band: number
  /** 3 votes per point (damaged input) or 1 (closed, consistent input). */
  votes: 1 | 3
  /** Extra room around the mesh bounds. */
  pad?: number
}

// Rows are nudged off the grid lines by an irrational fraction so rays do not graze edges.
const NUDGE = 0.000137

export function distanceGrid(mesh: IndexedTriangles, options: DistanceGridOptions): DistanceGrid {
  const { spacing, band, votes } = options
  const bvh = new TriangleBvh(mesh)
  const pad = (options.pad ?? 0) + 2 * spacing
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const v of mesh.indices)
    for (let k = 0; k < 3; k++) {
      const x = mesh.positions[v * 3 + k]!
      lo[k] = Math.min(lo[k]!, x)
      hi[k] = Math.max(hi[k]!, x)
    }
  const origin = lo.map((v) => v - pad) as [number, number, number]
  const size = hi.map((v, k) => Math.ceil((v + pad - origin[k]!) / spacing) + 1) as [
    number,
    number,
    number,
  ]
  const [nx, ny, nz] = size
  const count = nx * ny * nz
  if (count > 40_000_000) throw new Error('The mesh is too large to re-surface at this resolution')
  const at = (i: number, j: number, k: number) => (k * ny + j) * nx + i
  const inside = new Uint8Array(count)

  // Winding number along rows of one axis: `axis` is the ray direction, (a, b) the other two.
  const castRows = (axis: 0 | 1 | 2) => {
    const a = ((axis + 1) % 3) as 0 | 1 | 2
    const b = ((axis + 2) % 3) as 0 | 1 | 2
    const dir = [0, 0, 0]
    dir[axis] = 1
    for (let ib = 0; ib < size[b]; ib++)
      for (let ia = 0; ia < size[a]; ia++) {
        const o = [0, 0, 0]
        o[axis] = origin[axis] - spacing
        o[a] = origin[a] + (ia + NUDGE) * spacing
        o[b] = origin[b] + (ib + NUDGE * 1.618) * spacing
        const hits = bvh.crossings(o[0]!, o[1]!, o[2]!, dir[0]!, dir[1]!, dir[2]!)
        let h = 0
        let winding = 0
        const idx = [0, 0, 0]
        idx[a] = ia
        idx[b] = ib
        for (let i = 0; i < size[axis]; i++) {
          const t = (i + 1) * spacing
          while (h < hits.length && hits[h]!.t < t) winding += hits[h++]!.w
          if (winding > 0) {
            idx[axis] = i
            inside[at(idx[0]!, idx[1]!, idx[2]!)]!++
          }
        }
      }
  }
  castRows(2)
  if (votes === 3) {
    castRows(0)
    castRows(1)
  }
  const majority = votes === 3 ? 2 : 1

  const values = new Float32Array(count)
  const hit: ClosestHit = { d2: 0, x: 0, y: 0, z: 0, triangle: -1 }
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const n = at(i, j, k)
        const x = origin[0] + i * spacing
        const y = origin[1] + j * spacing
        const z = origin[2] + k * spacing
        const d = bvh.closest(x, y, z, hit, band) ? Math.sqrt(hit.d2) : band
        values[n] = inside[n]! >= majority ? d : -d
      }
  return { origin, spacing, size, values, band }
}

/** Trilinear interpolation of the grid; outside it the surface is far away and outside. */
export function sampleDistance(g: DistanceGrid, x: number, y: number, z: number): number {
  const [nx, ny, nz] = g.size
  const fx = (x - g.origin[0]) / g.spacing
  const fy = (y - g.origin[1]) / g.spacing
  const fz = (z - g.origin[2]) / g.spacing
  const i = Math.floor(fx)
  const j = Math.floor(fy)
  const k = Math.floor(fz)
  if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return -g.band
  const tx = fx - i
  const ty = fy - j
  const tz = fz - k
  const v = g.values
  const row = nx
  const slab = nx * ny
  const base = k * slab + j * row + i
  const c00 = v[base]! * (1 - tx) + v[base + 1]! * tx
  const c10 = v[base + row]! * (1 - tx) + v[base + row + 1]! * tx
  const c01 = v[base + slab]! * (1 - tx) + v[base + slab + 1]! * tx
  const c11 = v[base + slab + row]! * (1 - tx) + v[base + slab + row + 1]! * tx
  return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz
}

/** The iso-surface `distance = level` of the grid as a Manifold (level > 0 insets). */
export function levelSetOf(g: DistanceGrid, level: number): Manifold {
  const { manifold: mf } = runtime()
  const box: Box = {
    min: [g.origin[0], g.origin[1], g.origin[2]],
    max: [
      g.origin[0] + (g.size[0] - 1) * g.spacing,
      g.origin[1] + (g.size[1] - 1) * g.spacing,
      g.origin[2] + (g.size[2] - 1) * g.spacing,
    ],
  }
  return mf.Manifold.levelSet((p) => sampleDistance(g, p[0], p[1], p[2]), box, g.spacing, level)
}
