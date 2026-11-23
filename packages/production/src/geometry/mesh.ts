/**
 * Mesh topology for drawings and manufacturability checks: welding split vertices, an edge
 * table with face adjacency, manifold/shell analysis and signed volume. Everything works on flat
 * typed arrays with open-addressing hash tables so a million-triangle part stays in the
 * sub-second range.
 */
import type { MeshData } from '@pave/kernel/types'
import { transformDir, transformPoint } from './vec'

/** Positions + indices in world space; normals optional (per vertex, same length as positions). */
export interface Tris {
  positions: Float32Array
  indices: Uint32Array
  normals?: Float32Array
}

const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(16, n)))

/**
 * Maps every vertex to a canonical vertex at the same position (within `tolerance` mm), so
 * hard-edge vertex splits do not break adjacency. Returns the canonical index per vertex.
 */
export function weld(positions: Float32Array, tolerance = 1e-5): Uint32Array {
  const n = positions.length / 3
  const out = new Uint32Array(n)
  const size = nextPow2(n * 2)
  const mask = size - 1
  const table = new Int32Array(size).fill(-1)
  const q = new Int32Array(n * 3)
  const inv = 1 / tolerance
  for (let i = 0; i < n; i++) {
    const x = Math.round(positions[i * 3]! * inv)
    const y = Math.round(positions[i * 3 + 1]! * inv)
    const z = Math.round(positions[i * 3 + 2]! * inv)
    q[i * 3] = x
    q[i * 3 + 1] = y
    q[i * 3 + 2] = z
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask
    for (;;) {
      const j = table[h]!
      if (j < 0) {
        table[h] = i
        out[i] = i
        break
      }
      if (q[j * 3] === x && q[j * 3 + 1] === y && q[j * 3 + 2] === z) {
        out[i] = j
        break
      }
      h = (h + 1) & mask
    }
  }
  return out
}

/**
 * Undirected edges of a triangle mesh over canonical vertices. For each edge: its two
 * endpoints, the first two faces using it, the use count and the orientation balance
 * (+1 per a→b half-edge, −1 per b→a); a closed, consistently oriented edge has count 2 and
 * balance 0.
 */
export interface EdgeTable {
  count: number
  a: Uint32Array
  b: Uint32Array
  f0: Int32Array
  f1: Int32Array
  uses: Uint8Array
  balance: Int8Array
}

export function edgeTable(indices: Uint32Array, canon: Uint32Array): EdgeTable {
  const faces = indices.length / 3
  const cap = nextPow2(faces * 3)
  const mask = cap - 1
  const slot = new Int32Array(cap).fill(-1)
  const max = faces * 3
  const a = new Uint32Array(max)
  const b = new Uint32Array(max)
  const f0 = new Int32Array(max).fill(-1)
  const f1 = new Int32Array(max).fill(-1)
  const uses = new Uint8Array(max)
  const balance = new Int8Array(max)
  let count = 0
  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const u = canon[indices[f * 3 + k]!]!
      const v = canon[indices[f * 3 + ((k + 1) % 3)]!]!
      if (u === v) continue
      const lo = u < v ? u : v
      const hi = u < v ? v : u
      let h = (Math.imul(lo, 2654435761) ^ Math.imul(hi, 40503)) & mask
      let e = -1
      for (;;) {
        const s = slot[h]!
        if (s < 0) {
          e = count++
          slot[h] = e
          a[e] = lo
          b[e] = hi
          break
        }
        if (a[s] === lo && b[s] === hi) {
          e = s
          break
        }
        h = (h + 1) & mask
      }
      if (f0[e]! < 0) f0[e] = f
      else if (f1[e]! < 0) f1[e] = f
      if (uses[e]! < 255) uses[e]!++
      balance[e] = Math.max(-127, Math.min(127, balance[e]! + (u === lo ? 1 : -1)))
    }
  }
  return {
    count,
    a: a.subarray(0, count),
    b: b.subarray(0, count),
    f0: f0.subarray(0, count),
    f1: f1.subarray(0, count),
    uses: uses.subarray(0, count),
    balance: balance.subarray(0, count),
  }
}

export interface Topology {
  triangles: number
  /** Edges used by one face only (holes). */
  boundaryEdges: number
  /** Edges shared by more than two faces. */
  nonManifoldEdges: number
  /** Edges whose two faces disagree on winding (flipped normals). */
  misorientedEdges: number
  /** Connected face components. */
  shells: number
  /** Signed volume per shell, mm³ (negative = inward-facing, e.g. an internal cavity). */
  shellVolumes: number[]
  volumeMm3: number
  watertight: boolean
}

/** Closed/manifold/orientation/shell analysis — the checks casters run on upload. */
export function analyzeTopology(positions: Float32Array, indices: Uint32Array): Topology {
  const canon = weld(positions)
  const edges = edgeTable(indices, canon)
  let boundaryEdges = 0
  let nonManifoldEdges = 0
  let misorientedEdges = 0
  const faces = indices.length / 3
  const parent = new Int32Array(faces)
  for (let i = 0; i < faces; i++) parent[i] = i
  const find = (x: number) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  for (let e = 0; e < edges.count; e++) {
    const uses = edges.uses[e]!
    if (uses === 1) boundaryEdges++
    else if (uses > 2) nonManifoldEdges++
    else if (edges.balance[e] !== 0) misorientedEdges++
    if (edges.f1[e]! >= 0) {
      const r0 = find(edges.f0[e]!)
      const r1 = find(edges.f1[e]!)
      if (r0 !== r1) parent[r0] = r1
    }
  }
  const shellOf = new Map<number, number>()
  const shellVolumes: number[] = []
  for (let f = 0; f < faces; f++) {
    const r = find(f)
    let s = shellOf.get(r)
    if (s === undefined) {
      s = shellVolumes.length
      shellOf.set(r, s)
      shellVolumes.push(0)
    }
    shellVolumes[s]! += signedTetVolume(positions, indices, f)
  }
  const volumeMm3 = shellVolumes.reduce((t, v) => t + v, 0)
  return {
    triangles: faces,
    boundaryEdges,
    nonManifoldEdges,
    misorientedEdges,
    shells: shellVolumes.length,
    shellVolumes,
    volumeMm3,
    watertight: boundaryEdges === 0 && nonManifoldEdges === 0 && misorientedEdges === 0,
  }
}

function signedTetVolume(p: Float32Array, idx: Uint32Array, f: number): number {
  const i = idx[f * 3]! * 3
  const j = idx[f * 3 + 1]! * 3
  const k = idx[f * 3 + 2]! * 3
  const ax = p[i]!
  const ay = p[i + 1]!
  const az = p[i + 2]!
  const bx = p[j]!
  const by = p[j + 1]!
  const bz = p[j + 2]!
  const cx = p[k]!
  const cy = p[k + 1]!
  const cz = p[k + 2]!
  return (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
}

/** Unit face normal of triangle f into `out` at offset `o`; returns twice the area. */
export function faceNormal(p: Float32Array, idx: Uint32Array, f: number, out: Float32Array, o: number): number {
  const i = idx[f * 3]! * 3
  const j = idx[f * 3 + 1]! * 3
  const k = idx[f * 3 + 2]! * 3
  const ux = p[j]! - p[i]!
  const uy = p[j + 1]! - p[i + 1]!
  const uz = p[j + 2]! - p[i + 2]!
  const vx = p[k]! - p[i]!
  const vy = p[k + 1]! - p[i + 1]!
  const vz = p[k + 2]! - p[i + 2]!
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const l = Math.hypot(nx, ny, nz)
  const s = l > 0 ? 1 / l : 0
  out[o] = nx * s
  out[o + 1] = ny * s
  out[o + 2] = nz * s
  return l
}

export function faceNormals(t: Tris): Float32Array {
  const faces = t.indices.length / 3
  const out = new Float32Array(faces * 3)
  for (let f = 0; f < faces; f++) faceNormal(t.positions, t.indices, f, out, f * 3)
  return out
}

/** Places an instanced unit mesh in the world (normals by the inverse transpose). */
export function instanceMesh(mesh: MeshData, matrix: readonly number[]): Tris {
  const n = mesh.positions.length / 3
  const positions = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const w = transformPoint(matrix, mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!)
    positions.set(w, i * 3)
  }
  return { positions, indices: mesh.indices }
}

/** Concatenates meshes into one (indices rebased). */
export function mergeTris(list: readonly Tris[]): Tris {
  let nv = 0
  let ni = 0
  for (const t of list) {
    nv += t.positions.length
    ni += t.indices.length
  }
  const positions = new Float32Array(nv)
  const indices = new Uint32Array(ni)
  let ov = 0
  let oi = 0
  for (const t of list) {
    positions.set(t.positions, ov)
    const base = ov / 3
    for (let i = 0; i < t.indices.length; i++) indices[oi + i] = t.indices[i]! + base
    ov += t.positions.length
    oi += t.indices.length
  }
  return { positions, indices }
}

/** Girdle extent of a placed unit gem: its centre and the world directions of its axes. */
export function stoneFrame(matrix: readonly number[]) {
  return {
    centre: transformPoint(matrix, 0, 0, 0),
    up: transformDir(matrix, 0, 0, 1),
  }
}
