/**
 * Narrow-band marching tetrahedra over a signed distance function: a coarse grid finds the cells
 * near the surface, fine cells inside them are split into six tetrahedra sharing the main
 * diagonal (consistent across neighbours), and crossing vertices are shared per grid edge — so
 * the result is closed and edge-manifold by construction. Test fixtures only.
 */
export type Sdf = (x: number, y: number, z: number) => number

export interface SdfMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
] as const
const TETS = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
] as const

export function meshSdf(
  sdf: Sdf,
  min: [number, number, number],
  max: [number, number, number],
  h: number,
  block = 4,
): SdfMesh {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1
  const ny = Math.ceil((max[1] - min[1]) / h) + 1
  const nz = Math.ceil((max[2] - min[2]) / h) + 1
  const gid = (i: number, j: number, k: number) => i + nx * (j + ny * k)
  const total = nx * ny * nz
  const positions: number[] = []
  const indices: number[] = []
  const vertexOf = new Map<number, number>()
  const value = (i: number, j: number, k: number) => {
    const v = sdf(min[0] + i * h, min[1] + j * h, min[2] + k * h)
    return v === 0 ? 1e-9 : v
  }
  const H = block * h
  // Generous margin: smooth unions and varying sections are only roughly 1-Lipschitz.
  const reach = (H * Math.sqrt(3) * 0.5 + h) * 1.6
  const local = new Float64Array((block + 1) ** 3)
  const ids = new Float64Array((block + 1) ** 3)

  for (let bk = 0; bk < nz - 1; bk += block) {
    for (let bj = 0; bj < ny - 1; bj += block) {
      for (let bi = 0; bi < nx - 1; bi += block) {
        const c = sdf(min[0] + (bi + block / 2) * h, min[1] + (bj + block / 2) * h, min[2] + (bk + block / 2) * h)
        if (Math.abs(c) > reach) continue
        const ei = Math.min(block, nx - 1 - bi)
        const ej = Math.min(block, ny - 1 - bj)
        const ek = Math.min(block, nz - 1 - bk)
        const L = block + 1
        for (let k = 0; k <= ek; k++)
          for (let j = 0; j <= ej; j++)
            for (let i = 0; i <= ei; i++) {
              local[i + L * (j + L * k)] = value(bi + i, bj + j, bk + k)
              ids[i + L * (j + L * k)] = gid(bi + i, bj + j, bk + k)
            }
        for (let k = 0; k < ek; k++)
          for (let j = 0; j < ej; j++)
            for (let i = 0; i < ei; i++) {
              const cv: number[] = []
              const cid: number[] = []
              const cp: [number, number, number][] = []
              for (const [dx, dy, dz] of CORNERS) {
                const li = i + dx + L * (j + dy + L * (k + dz))
                cv.push(local[li]!)
                cid.push(ids[li]!)
                cp.push([min[0] + (bi + i + dx) * h, min[1] + (bj + j + dy) * h, min[2] + (bk + k + dz) * h])
              }
              if (cv.every((v) => v > 0) || cv.every((v) => v < 0)) continue
              for (const t of TETS) polygonise(t, cv, cid, cp, total, vertexOf, positions, indices)
            }
      }
    }
  }

  const normals = new Float32Array(positions.length)
  const e = h * 0.5
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v]!
    const y = positions[v + 1]!
    const z = positions[v + 2]!
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z)
    const gy = sdf(x, y + e, z) - sdf(x, y - e, z)
    const gz = sdf(x, y, z + e) - sdf(x, y, z - e)
    const l = Math.hypot(gx, gy, gz) || 1
    normals[v] = gx / l
    normals[v + 1] = gy / l
    normals[v + 2] = gz / l
  }
  return { positions: Float32Array.from(positions), normals, indices: Uint32Array.from(indices) }
}

function polygonise(
  t: readonly number[],
  cv: number[],
  cid: number[],
  cp: [number, number, number][],
  total: number,
  vertexOf: Map<number, number>,
  positions: number[],
  indices: number[],
) {
  const inside = t.filter((c) => cv[c]! < 0)
  const outside = t.filter((c) => cv[c]! >= 0)
  if (inside.length === 0 || outside.length === 0) return
  const cross = (a: number, b: number): number => {
    const ia = cid[a]!
    const ib = cid[b]!
    const key = ia < ib ? ia * total + ib : ib * total + ia
    let v = vertexOf.get(key)
    if (v === undefined) {
      const [lo, hi] = ia < ib ? [a, b] : [b, a]
      const s = cv[lo]! / (cv[lo]! - cv[hi]!)
      const p = cp[lo]!
      const q = cp[hi]!
      v = positions.length / 3
      positions.push(p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, p[2] + (q[2] - p[2]) * s)
      vertexOf.set(key, v)
    }
    return v
  }
  const centroid = (cs: number[]) => {
    const c = [0, 0, 0]
    for (const k of cs) for (let a = 0; a < 3; a++) c[a]! += cp[k]![a]! / cs.length
    return c
  }
  const ci = centroid(inside)
  const co = centroid(outside)
  const out = [co[0]! - ci[0]!, co[1]! - ci[1]!, co[2]! - ci[2]!]
  const emit = (a: number, b: number, c: number) => {
    if (a === b || b === c || a === c) return
    const pa = a * 3
    const pb = b * 3
    const pc = c * 3
    const ux = positions[pb]! - positions[pa]!
    const uy = positions[pb + 1]! - positions[pa + 1]!
    const uz = positions[pb + 2]! - positions[pa + 2]!
    const vx = positions[pc]! - positions[pa]!
    const vy = positions[pc + 1]! - positions[pa + 1]!
    const vz = positions[pc + 2]! - positions[pa + 2]!
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    if (nx * out[0]! + ny * out[1]! + nz * out[2]! >= 0) indices.push(a, b, c)
    else indices.push(a, c, b)
  }
  if (inside.length === 1 || outside.length === 1) {
    const [lone, others] = inside.length === 1 ? [inside[0]!, outside] : [outside[0]!, inside]
    emit(cross(lone, others[0]!), cross(lone, others[1]!), cross(lone, others[2]!))
    return
  }
  const [a, b] = inside as [number, number]
  const [c, d] = outside as [number, number]
  const ac = cross(a, c)
  const ad = cross(a, d)
  const bc = cross(b, c)
  const bd = cross(b, d)
  emit(ac, ad, bd)
  emit(ac, bd, bc)
}
