/**
 * A flat bounding-volume hierarchy over triangles for ray queries (wall thickness, point
 * containment). Built by median split on the longest centroid axis with quickselect, so the
 * build is O(n log n) without allocation per node.
 */
import type { Tris } from './mesh'

const LEAF = 4

export interface Hit {
  t: number
  tri: number
}

export class TriangleBVH {
  private readonly p: Float32Array
  private readonly idx: Uint32Array
  /** Triangle ids in leaf order. */
  private readonly order: Uint32Array
  /** Per node: minx, miny, minz, maxx, maxy, maxz. */
  private readonly box: Float32Array
  /** Per node: [left child | first triangle, count (0 = inner node)]. */
  private readonly node: Int32Array
  private nodes = 0

  constructor(mesh: Tris) {
    this.p = mesh.positions
    this.idx = mesh.indices
    const n = mesh.indices.length / 3
    this.order = new Uint32Array(n)
    for (let i = 0; i < n; i++) this.order[i] = i
    const maxNodes = Math.max(1, 2 * Math.ceil(n / LEAF) + 1) * 2
    this.box = new Float32Array(maxNodes * 6)
    this.node = new Int32Array(maxNodes * 2)
    const cent = new Float32Array(n * 3)
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 3; k++) {
        const v = this.idx[t * 3 + k]! * 3
        cent[t * 3] = cent[t * 3]! + this.p[v]! / 3
        cent[t * 3 + 1] = cent[t * 3 + 1]! + this.p[v + 1]! / 3
        cent[t * 3 + 2] = cent[t * 3 + 2]! + this.p[v + 2]! / 3
      }
    }
    if (n > 0) this.build(cent, n)
  }

  private build(cent: Float32Array, n: number) {
    const stack: [node: number, start: number, end: number][] = [[this.nodes++, 0, n]]
    while (stack.length) {
      const [nd, start, end] = stack.pop()!
      this.fitBox(nd, start, end)
      const count = end - start
      if (count <= LEAF) {
        this.node[nd * 2] = start
        this.node[nd * 2 + 1] = count
        continue
      }
      let lo0 = Infinity
      let lo1 = Infinity
      let lo2 = Infinity
      let hi0 = -Infinity
      let hi1 = -Infinity
      let hi2 = -Infinity
      for (let i = start; i < end; i++) {
        const c = this.order[i]! * 3
        lo0 = Math.min(lo0, cent[c]!)
        hi0 = Math.max(hi0, cent[c]!)
        lo1 = Math.min(lo1, cent[c + 1]!)
        hi1 = Math.max(hi1, cent[c + 1]!)
        lo2 = Math.min(lo2, cent[c + 2]!)
        hi2 = Math.max(hi2, cent[c + 2]!)
      }
      const ex = [hi0 - lo0, hi1 - lo1, hi2 - lo2]
      const axis = ex[0]! >= ex[1]! && ex[0]! >= ex[2]! ? 0 : ex[1]! >= ex[2]! ? 1 : 2
      const mid = (start + end) >> 1
      this.select(cent, axis, start, end - 1, mid)
      const left = this.nodes++
      const right = this.nodes++
      this.node[nd * 2] = left
      this.node[nd * 2 + 1] = 0
      stack.push([left, start, mid], [right, mid, end])
    }
  }

  /** Quickselect: partially orders `order[lo..hi]` so the k-th centroid on `axis` is in place. */
  private select(cent: Float32Array, axis: number, lo: number, hi: number, k: number) {
    const o = this.order
    while (hi > lo) {
      const pivot = cent[o[(lo + hi) >> 1]! * 3 + axis]!
      let i = lo
      let j = hi
      while (i <= j) {
        while (cent[o[i]! * 3 + axis]! < pivot) i++
        while (cent[o[j]! * 3 + axis]! > pivot) j--
        if (i <= j) {
          const t = o[i]!
          o[i] = o[j]!
          o[j] = t
          i++
          j--
        }
      }
      if (k <= j) hi = j
      else if (k >= i) lo = i
      else return
    }
  }

  private fitBox(nd: number, start: number, end: number) {
    const b = this.box
    const o = nd * 6
    b[o] = b[o + 1] = b[o + 2] = Infinity
    b[o + 3] = b[o + 4] = b[o + 5] = -Infinity
    for (let i = start; i < end; i++) {
      const t = this.order[i]!
      for (let k = 0; k < 3; k++) {
        const v = this.idx[t * 3 + k]! * 3
        for (let a = 0; a < 3; a++) {
          const c = this.p[v + a]!
          if (c < b[o + a]!) b[o + a] = c
          if (c > b[o + 3 + a]!) b[o + 3 + a] = c
        }
      }
    }
  }

  /**
   * Nearest intersection along a ray within (tMin, tMax). `accept` can reject hits (e.g. by
   * which side of the triangle was struck).
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    tMin = 1e-6,
    tMax = Infinity,
    accept?: (tri: number) => boolean,
  ): Hit | null {
    if (this.order.length === 0) return null
    const ix = 1 / dx
    const iy = 1 / dy
    const iz = 1 / dz
    let best = tMax
    let bestTri = -1
    const stack = new Int32Array(128)
    let sp = 0
    stack[sp++] = 0
    while (sp > 0) {
      const nd = stack[--sp]!
      const o = nd * 6
      const b = this.box
      let t0 = ((ix >= 0 ? b[o]! : b[o + 3]!) - ox) * ix
      let t1 = ((ix >= 0 ? b[o + 3]! : b[o]!) - ox) * ix
      const ty0 = ((iy >= 0 ? b[o + 1]! : b[o + 4]!) - oy) * iy
      const ty1 = ((iy >= 0 ? b[o + 4]! : b[o + 1]!) - oy) * iy
      if (ty0 > t0) t0 = ty0
      if (ty1 < t1) t1 = ty1
      const tz0 = ((iz >= 0 ? b[o + 2]! : b[o + 5]!) - oz) * iz
      const tz1 = ((iz >= 0 ? b[o + 5]! : b[o + 2]!) - oz) * iz
      if (tz0 > t0) t0 = tz0
      if (tz1 < t1) t1 = tz1
      if (t0 > t1 || t1 < tMin || t0 > best) continue
      const count = this.node[nd * 2 + 1]!
      const first = this.node[nd * 2]!
      if (count === 0) {
        stack[sp++] = first
        stack[sp++] = first + 1
        continue
      }
      for (let i = first; i < first + count; i++) {
        const tri = this.order[i]!
        const t = this.intersect(tri, ox, oy, oz, dx, dy, dz)
        if (t > tMin && t < best && (!accept || accept(tri))) {
          best = t
          bestTri = tri
        }
      }
    }
    return bestTri < 0 ? null : { t: best, tri: bestTri }
  }

  /** Möller–Trumbore; returns the ray parameter or NaN. Two-sided. */
  private intersect(
    tri: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
  ): number {
    const p = this.p
    const a = this.idx[tri * 3]! * 3
    const b = this.idx[tri * 3 + 1]! * 3
    const c = this.idx[tri * 3 + 2]! * 3
    const e1x = p[b]! - p[a]!
    const e1y = p[b + 1]! - p[a + 1]!
    const e1z = p[b + 2]! - p[a + 2]!
    const e2x = p[c]! - p[a]!
    const e2y = p[c + 1]! - p[a + 1]!
    const e2z = p[c + 2]! - p[a + 2]!
    const px = dy * e2z - dz * e2y
    const py = dz * e2x - dx * e2z
    const pz = dx * e2y - dy * e2x
    const det = e1x * px + e1y * py + e1z * pz
    if (Math.abs(det) < 1e-14) return Number.NaN
    const inv = 1 / det
    const tx = ox - p[a]!
    const ty = oy - p[a + 1]!
    const tz = oz - p[a + 2]!
    const u = (tx * px + ty * py + tz * pz) * inv
    if (u < 0 || u > 1) return Number.NaN
    const qx = ty * e1z - tz * e1y
    const qy = tz * e1x - tx * e1z
    const qz = tx * e1y - ty * e1x
    const v = (dx * qx + dy * qy + dz * qz) * inv
    if (v < 0 || u + v > 1) return Number.NaN
    return (e2x * qx + e2y * qy + e2z * qz) * inv
  }

  /**
   * Point containment by majority vote over three skewed ray directions (parity counting), so
   * a ray grazing an edge cannot flip the answer.
   */
  contains(x: number, y: number, z: number): boolean {
    const dirs: [number, number, number][] = [
      [0.5773, 0.5774, 0.5775],
      [-0.6412, 0.2314, 0.7316],
      [0.1231, -0.9012, 0.4155],
    ]
    let inside = 0
    for (const [dx, dy, dz] of dirs) {
      let crossings = 0
      let t = 0
      for (let guard = 0; guard < 4096; guard++) {
        const hit = this.raycast(x, y, z, dx, dy, dz, t + 1e-7)
        if (!hit) break
        crossings++
        t = hit.t
      }
      if (crossings % 2 === 1) inside++
    }
    return inside >= 2
  }
}
