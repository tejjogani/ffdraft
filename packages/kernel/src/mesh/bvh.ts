/**
 * A bounding-volume hierarchy over triangles: closest-point and ray queries in O(log n). Used
 * for signed distances (re-surfacing, hollowing), local thickness under a stone seat, and to
 * snap points onto a surface. Pure typed-array code; works on welded or raw triangle soups.
 */
import type { IndexedTriangles } from '../solid/meshing'

const LEAF = 4

export interface ClosestHit {
  /** Squared distance to the closest point. */
  d2: number
  x: number
  y: number
  z: number
  /** Triangle index (into indices / 3). */
  triangle: number
}

export class TriangleBvh {
  private readonly order: Uint32Array
  /** Per node: min xyz, max xyz. */
  private readonly boxes: Float64Array
  /** Per node: first child (internal) or first `order` slot (leaf). */
  private readonly offset: Uint32Array
  /** Per node: triangle count for leaves, 0 for internal nodes. */
  private readonly count: Uint32Array
  private nodes = 0
  private readonly stack = new Uint32Array(128)

  constructor(readonly mesh: IndexedTriangles) {
    const triangles = mesh.indices.length / 3
    this.order = new Uint32Array(triangles)
    for (let i = 0; i < triangles; i++) this.order[i] = i
    const capacity = Math.max(1, 2 * Math.ceil(triangles / LEAF) + 1)
    this.boxes = new Float64Array(capacity * 6)
    this.offset = new Uint32Array(capacity)
    this.count = new Uint32Array(capacity)
    const centroids = new Float64Array(triangles * 3)
    const p = mesh.positions
    const idx = mesh.indices
    for (let t = 0; t < triangles; t++)
      for (let k = 0; k < 3; k++)
        centroids[t * 3 + k] =
          (p[idx[t * 3]! * 3 + k]! + p[idx[t * 3 + 1]! * 3 + k]! + p[idx[t * 3 + 2]! * 3 + k]!) / 3
    this.build(centroids, triangles)
  }

  private build(centroids: Float64Array, triangles: number): void {
    const p = this.mesh.positions
    const idx = this.mesh.indices
    const order = this.order
    const pending: [node: number, start: number, end: number][] = [[this.nodes++, 0, triangles]]
    while (pending.length > 0) {
      const [node, start, end] = pending.pop()!
      const b = node * 6
      this.boxes.fill(Infinity, b, b + 3)
      this.boxes.fill(-Infinity, b + 3, b + 6)
      const cmin = [Infinity, Infinity, Infinity]
      const cmax = [-Infinity, -Infinity, -Infinity]
      for (let i = start; i < end; i++) {
        const t = order[i]!
        for (let c = 0; c < 3; c++) {
          const v = idx[t * 3 + c]! * 3
          for (let k = 0; k < 3; k++) {
            const x = p[v + k]!
            if (x < this.boxes[b + k]!) this.boxes[b + k] = x
            if (x > this.boxes[b + 3 + k]!) this.boxes[b + 3 + k] = x
          }
        }
        for (let k = 0; k < 3; k++) {
          const c = centroids[t * 3 + k]!
          if (c < cmin[k]!) cmin[k] = c
          if (c > cmax[k]!) cmax[k] = c
        }
      }
      if (end - start <= LEAF) {
        this.offset[node] = start
        this.count[node] = end - start
        continue
      }
      const ex = cmax[0]! - cmin[0]!
      const ey = cmax[1]! - cmin[1]!
      const ez = cmax[2]! - cmin[2]!
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2
      const mid = (start + end) >> 1
      selectNth(order, centroids, axis, start, end - 1, mid)
      const left = this.nodes
      this.nodes += 2
      this.offset[node] = left
      this.count[node] = 0
      pending.push([left, start, mid], [left + 1, mid, end])
    }
  }

  /** Squared distance from a point to a node's box. */
  private boxDistance2(node: number, x: number, y: number, z: number): number {
    const b = node * 6
    const bx = this.boxes
    const dx = Math.max(bx[b]! - x, 0, x - bx[b + 3]!)
    const dy = Math.max(bx[b + 1]! - y, 0, y - bx[b + 4]!)
    const dz = Math.max(bx[b + 2]! - z, 0, z - bx[b + 5]!)
    return dx * dx + dy * dy + dz * dz
  }

  /**
   * The closest surface point to (x, y, z) no farther than `maxDistance`. Returns false (and
   * leaves `out` untouched) when nothing is that close — far queries are then very cheap.
   */
  closest(x: number, y: number, z: number, out: ClosestHit, maxDistance = Infinity): boolean {
    let best = maxDistance * maxDistance
    let found = false
    const stack = this.stack
    let top = 0
    stack[top++] = 0
    const q = { x: 0, y: 0, z: 0 }
    while (top > 0) {
      const node = stack[--top]!
      if (this.boxDistance2(node, x, y, z) > best) continue
      const n = this.count[node]!
      if (n > 0) {
        const start = this.offset[node]!
        for (let i = start; i < start + n; i++) {
          const t = this.order[i]!
          const d2 = this.closestOnTriangle(t, x, y, z, q)
          if (d2 < best || (!found && d2 <= best)) {
            best = d2
            found = true
            out.d2 = d2
            out.x = q.x
            out.y = q.y
            out.z = q.z
            out.triangle = t
          }
        }
        continue
      }
      const left = this.offset[node]!
      const dl = this.boxDistance2(left, x, y, z)
      const dr = this.boxDistance2(left + 1, x, y, z)
      // Visit the nearer child first (pushed last).
      if (dl < dr) {
        stack[top++] = left + 1
        stack[top++] = left
      } else {
        stack[top++] = left
        stack[top++] = left + 1
      }
    }
    return found
  }

  /**
   * Distance along the unit ray o + t·d to the first triangle hit with t in (tMin, tMax), or
   * Infinity. `skip` excludes one triangle (the one a ray starts on).
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    tMin = 0,
    tMax = Infinity,
    skip = -1,
  ): number {
    let best = tMax
    this.traverseRay(ox, oy, oz, dx, dy, dz, () => best, (t, triangle) => {
      if (triangle !== skip && t > tMin && t < best) best = t
    })
    return best < tMax ? best : Infinity
  }

  /** Sorted ray parameters of every triangle the ray o + t·d crosses at t > 0 (parity tests). */
  hits(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number[] {
    const out: number[] = []
    this.traverseRay(ox, oy, oz, dx, dy, dz, () => Infinity, (t) => {
      if (t > 0) out.push(t)
    })
    return out.sort((a, b) => a - b)
  }

  private traverseRay(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    limit: () => number,
    hit: (t: number, triangle: number) => void,
  ): void {
    const ix = 1 / dx
    const iy = 1 / dy
    const iz = 1 / dz
    const stack = this.stack
    const bx = this.boxes
    let top = 0
    stack[top++] = 0
    while (top > 0) {
      const node = stack[--top]!
      const b = node * 6
      let t0 = (bx[b]! - ox) * ix
      let t1 = (bx[b + 3]! - ox) * ix
      let tn = Math.min(t0, t1)
      let tf = Math.max(t0, t1)
      t0 = (bx[b + 1]! - oy) * iy
      t1 = (bx[b + 4]! - oy) * iy
      tn = Math.max(tn, Math.min(t0, t1))
      tf = Math.min(tf, Math.max(t0, t1))
      t0 = (bx[b + 2]! - oz) * iz
      t1 = (bx[b + 5]! - oz) * iz
      tn = Math.max(tn, Math.min(t0, t1))
      tf = Math.min(tf, Math.max(t0, t1))
      if (!(tf >= Math.max(tn, 0)) || tn > limit()) continue
      const n = this.count[node]!
      if (n === 0) {
        stack[top++] = this.offset[node]!
        stack[top++] = this.offset[node]! + 1
        continue
      }
      const start = this.offset[node]!
      for (let i = start; i < start + n; i++) {
        const t = this.order[i]!
        const d = this.intersect(t, ox, oy, oz, dx, dy, dz)
        if (d !== null) hit(d, t)
      }
    }
  }

  /** Möller–Trumbore; returns the ray parameter or null. */
  private intersect(
    t: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
  ): number | null {
    const p = this.mesh.positions
    const idx = this.mesh.indices
    const a = idx[t * 3]! * 3
    const b = idx[t * 3 + 1]! * 3
    const c = idx[t * 3 + 2]! * 3
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
    if (Math.abs(det) < 1e-18) return null
    const inv = 1 / det
    const sx = ox - p[a]!
    const sy = oy - p[a + 1]!
    const sz = oz - p[a + 2]!
    const u = (sx * px + sy * py + sz * pz) * inv
    if (u < 0 || u > 1) return null
    const qx = sy * e1z - sz * e1y
    const qy = sz * e1x - sx * e1z
    const qz = sx * e1y - sy * e1x
    const v = (dx * qx + dy * qy + dz * qz) * inv
    if (v < 0 || u + v > 1) return null
    return (e2x * qx + e2y * qy + e2z * qz) * inv
  }

  /** Closest point on triangle t to p (Ericson, Real-Time Collision Detection §5.1.5). */
  private closestOnTriangle(
    t: number,
    px: number,
    py: number,
    pz: number,
    out: { x: number; y: number; z: number },
  ): number {
    const p = this.mesh.positions
    const idx = this.mesh.indices
    const a = idx[t * 3]! * 3
    const b = idx[t * 3 + 1]! * 3
    const c = idx[t * 3 + 2]! * 3
    const ax = p[a]!
    const ay = p[a + 1]!
    const az = p[a + 2]!
    const abx = p[b]! - ax
    const aby = p[b + 1]! - ay
    const abz = p[b + 2]! - az
    const acx = p[c]! - ax
    const acy = p[c + 1]! - ay
    const acz = p[c + 2]! - az
    const apx = px - ax
    const apy = py - ay
    const apz = pz - az
    const d1 = abx * apx + aby * apy + abz * apz
    const d2 = acx * apx + acy * apy + acz * apz
    let u: number
    let v: number
    if (d1 <= 0 && d2 <= 0) {
      u = 0
      v = 0
    } else {
      const bpx = px - p[b]!
      const bpy = py - p[b + 1]!
      const bpz = pz - p[b + 2]!
      const d3 = abx * bpx + aby * bpy + abz * bpz
      const d4 = acx * bpx + acy * bpy + acz * bpz
      const cpx = px - p[c]!
      const cpy = py - p[c + 1]!
      const cpz = pz - p[c + 2]!
      const d5 = abx * cpx + aby * cpy + abz * cpz
      const d6 = acx * cpx + acy * cpy + acz * cpz
      const vc = d1 * d4 - d3 * d2
      const vb = d5 * d2 - d1 * d6
      const va = d3 * d6 - d5 * d4
      if (d3 >= 0 && d4 <= d3) {
        u = 1
        v = 0
      } else if (d6 >= 0 && d5 <= d6) {
        u = 0
        v = 1
      } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        u = d1 / (d1 - d3)
        v = 0
      } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        u = 0
        v = d2 / (d2 - d6)
      } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
        u = 1 - w
        v = w
      } else {
        const denom = 1 / (va + vb + vc)
        u = vb * denom
        v = vc * denom
      }
    }
    out.x = ax + abx * u + acx * v
    out.y = ay + aby * u + acy * v
    out.z = az + abz * u + acz * v
    const dx = px - out.x
    const dy = py - out.y
    const dz = pz - out.z
    return dx * dx + dy * dy + dz * dz
  }
}

/** Partially orders `order[lo..hi]` so the element at `nth` is in its sorted place (quickselect). */
function selectNth(
  order: Uint32Array,
  keys: Float64Array,
  axis: number,
  lo: number,
  hi: number,
  nth: number,
): void {
  const key = (i: number) => keys[order[i]! * 3 + axis]!
  while (hi > lo) {
    const pivot = key((lo + hi) >> 1)
    let i = lo
    let j = hi
    while (i <= j) {
      while (key(i) < pivot) i++
      while (key(j) > pivot) j--
      if (i <= j) {
        const tmp = order[i]!
        order[i] = order[j]!
        order[j] = tmp
        i++
        j--
      }
    }
    if (nth <= j) hi = j
    else if (nth >= i) lo = i
    else return
  }
}
