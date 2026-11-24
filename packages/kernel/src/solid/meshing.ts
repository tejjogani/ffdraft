/**
 * Triangle-mesh utilities shared by every solid representation: welding, crease-aware normals,
 * feature edges and integral properties. Pure typed-array code, no WASM.
 */
import type { Mat4 } from '../geometry/vec'
import type { Bounds, MeshData } from '../types'

/** Welded triangles: every vertex is unique, so a closed surface is edge-manifold. */
export interface IndexedTriangles {
  positions: Float32Array
  indices: Uint32Array
}

/** What a viewer needs for one solid. */
export interface Tessellation {
  mesh: MeshData
  /** Feature edges as line segments (x0,y0,z0,x1,y1,z1,…). */
  edges: Float32Array
}

/** Faces meeting at more than this dihedral angle are drawn with a hard edge between them. */
export const CREASE_ANGLE = (32 * Math.PI) / 180

/**
 * Merges vertices with identical coordinates (B-rep tessellators emit each face separately but
 * share the edge discretisation exactly) and drops triangles that collapse.
 */
export function weld(positions: Float32Array, indices: Uint32Array): IndexedTriangles {
  const count = positions.length / 3
  const scratch = new Float32Array(3)
  const bits = new Uint32Array(scratch.buffer)
  let capacity = 16
  while (capacity < count * 2) capacity *= 2
  const table = new Int32Array(capacity).fill(-1)
  const remap = new Uint32Array(count)
  const unique = new Float32Array(positions.length)
  let n = 0
  for (let i = 0; i < count; i++) {
    // +0 and −0 compare equal but have different bit patterns; adding 0 folds them together.
    const x = positions[i * 3]! + 0
    const y = positions[i * 3 + 1]! + 0
    const z = positions[i * 3 + 2]! + 0
    scratch[0] = x
    scratch[1] = y
    scratch[2] = z
    let h = Math.imul(bits[0]!, 73856093) ^ Math.imul(bits[1]!, 19349663)
    h = (h ^ Math.imul(bits[2]!, 83492791)) & (capacity - 1)
    for (;;) {
      const at = table[h]!
      if (at < 0) {
        table[h] = n
        unique[n * 3] = x
        unique[n * 3 + 1] = y
        unique[n * 3 + 2] = z
        remap[i] = n++
        break
      }
      if (unique[at * 3] === x && unique[at * 3 + 1] === y && unique[at * 3 + 2] === z) {
        remap[i] = at
        break
      }
      h = (h + 1) & (capacity - 1)
    }
  }
  const out = new Uint32Array(indices.length)
  let t = 0
  for (let i = 0; i < indices.length; i += 3) {
    const a = remap[indices[i]!]!
    const b = remap[indices[i + 1]!]!
    const c = remap[indices[i + 2]!]!
    if (a === b || b === c || c === a) continue
    out[t++] = a
    out[t++] = b
    out[t++] = c
  }
  return { positions: unique.slice(0, n * 3), indices: out.slice(0, t) }
}

/**
 * Opens "kissing" contacts. A boolean can leave two sheets of a surface touching along an edge
 * or at a point: valid topology, but any consumer that identifies vertices by position (every
 * STL reader) sees a non-manifold edge there. Vertices that share a position are each drawn
 * back along their own normal by `gap`, which parts the sheets by a hair. Returns null when no
 * two vertices coincide.
 */
export function separateTouching(tris: IndexedTriangles, gap = 2e-4): IndexedTriangles | null {
  const { positions, indices } = tris
  const count = positions.length / 3
  const welded = weld(positions, indices)
  if (welded.positions.length === positions.length) return null
  // Which vertices share their position with another one.
  const key = (i: number) => `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`
  const seen = new Map<string, number>()
  const shared = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const k = key(i)
    const other = seen.get(k)
    if (other === undefined) seen.set(k, i)
    else shared[i] = shared[other] = 1
  }
  const normals = new Float64Array(positions.length)
  const fn = faceNormals(tris)
  for (let t = 0; t < indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const v = indices[t + e]! * 3
      normals[v]! += fn[t]!
      normals[v + 1]! += fn[t + 1]!
      normals[v + 2]! += fn[t + 2]!
    }
  const moved = positions.slice()
  for (let i = 0; i < count; i++) {
    if (!shared[i]) continue
    const l = Math.hypot(normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!) || 1
    for (let c = 0; c < 3; c++)
      moved[i * 3 + c] = positions[i * 3 + c]! - (normals[i * 3 + c]! / l) * gap
  }
  return { positions: moved, indices }
}

/** Unnormalised face normals (length = 2 × area), one xyz triple per triangle. */
function faceNormals({ positions: p, indices }: IndexedTriangles): Float32Array {
  const normals = new Float32Array(indices.length)
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3
    const b = indices[i + 1]! * 3
    const c = indices[i + 2]! * 3
    const ux = p[b]! - p[a]!
    const uy = p[b + 1]! - p[a + 1]!
    const uz = p[b + 2]! - p[a + 2]!
    const vx = p[c]! - p[a]!
    const vy = p[c + 1]! - p[a + 1]!
    const vz = p[c + 2]! - p[a + 2]!
    normals[i] = uy * vz - uz * vy
    normals[i + 1] = uz * vx - ux * vz
    normals[i + 2] = ux * vy - uy * vx
  }
  return normals
}

/** Segments along every edge whose two faces meet at more than `angle`, plus open edges. */
export function featureEdges(tris: IndexedTriangles, angle = CREASE_ANGLE): Float32Array {
  const { positions, indices } = tris
  const normals = faceNormals(tris)
  const vertexCount = positions.length / 3
  const first = new Map<number, number>()
  const cosLimit = Math.cos(angle)
  const out: number[] = []
  const emit = (a: number, b: number) => {
    out.push(
      positions[a * 3]!, positions[a * 3 + 1]!, positions[a * 3 + 2]!,
      positions[b * 3]!, positions[b * 3 + 1]!, positions[b * 3 + 2]!,
    ) // biome-ignore format: one segment per line
  }
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e]!
      const b = indices[t + ((e + 1) % 3)]!
      const key = a < b ? a * vertexCount + b : b * vertexCount + a
      const other = first.get(key)
      if (other === undefined) {
        first.set(key, t)
        continue
      }
      first.delete(key)
      const d =
        normals[t]! * normals[other]! +
        normals[t + 1]! * normals[other + 1]! +
        normals[t + 2]! * normals[other + 2]!
      const l =
        Math.hypot(normals[t]!, normals[t + 1]!, normals[t + 2]!) *
        Math.hypot(normals[other]!, normals[other + 1]!, normals[other + 2]!)
      if (l > 0 && d / l < cosLimit) emit(a, b)
    }
  }
  for (const key of first.keys()) emit(Math.floor(key / vertexCount), key % vertexCount)
  return new Float32Array(out)
}

/**
 * Display mesh for welded triangles: vertex normals are averaged over the adjacent faces that
 * lie within `angle` of each other, and vertices are split across sharper creases.
 */
export function creaseNormals(tris: IndexedTriangles, angle = CREASE_ANGLE): MeshData {
  const { positions, indices } = tris
  const fn = faceNormals(tris)
  // Unit normals for the angle tests; `fn` keeps its area weighting for the averages.
  const unit = new Float32Array(fn.length)
  for (let t = 0; t < fn.length; t += 3) {
    const l = Math.hypot(fn[t]!, fn[t + 1]!, fn[t + 2]!) || 1
    unit[t] = fn[t]! / l
    unit[t + 1] = fn[t + 1]! / l
    unit[t + 2] = fn[t + 2]! / l
  }
  const vertexCount = positions.length / 3
  const cornerCount = indices.length
  // Corner lists per vertex (counting sort).
  const start = new Uint32Array(vertexCount + 1)
  for (let i = 0; i < cornerCount; i++) start[indices[i]! + 1]!++
  for (let v = 0; v < vertexCount; v++) start[v + 1]! += start[v]!
  const fill = start.slice(0, vertexCount)
  const corners = new Uint32Array(cornerCount)
  for (let i = 0; i < cornerCount; i++) corners[fill[indices[i]!]!++] = i

  const cosLimit = Math.cos(angle)
  // At most one output vertex per corner.
  const outPos = new Float32Array(cornerCount * 3)
  const outNrm = new Float32Array(cornerCount * 3)
  const outIdx = new Uint32Array(cornerCount)
  let count = 0
  for (let v = 0; v < vertexCount; v++) {
    const from = start[v]!
    const to = start[v + 1]!
    const first = count
    for (let k = from; k < to; k++) {
      const corner = corners[k]!
      const t = corner - (corner % 3)
      let nx = 0
      let ny = 0
      let nz = 0
      for (let j = from; j < to; j++) {
        const o = corners[j]! - (corners[j]! % 3)
        if (
          unit[t]! * unit[o]! + unit[t + 1]! * unit[o + 1]! + unit[t + 2]! * unit[o + 2]! >=
          cosLimit
        ) {
          nx += fn[o]!
          ny += fn[o + 1]!
          nz += fn[o + 2]!
        }
      }
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l
      ny /= l
      nz /= l
      // Corners whose normal matches one already emitted for this vertex share it.
      let index = -1
      for (let e = first; e < count; e++)
        if (
          Math.abs(outNrm[e * 3]! - nx) < 1e-4 &&
          Math.abs(outNrm[e * 3 + 1]! - ny) < 1e-4 &&
          Math.abs(outNrm[e * 3 + 2]! - nz) < 1e-4
        ) {
          index = e
          break
        }
      if (index < 0) {
        index = count++
        outPos[index * 3] = positions[v * 3]!
        outPos[index * 3 + 1] = positions[v * 3 + 1]!
        outPos[index * 3 + 2] = positions[v * 3 + 2]!
        outNrm[index * 3] = nx
        outNrm[index * 3 + 1] = ny
        outNrm[index * 3 + 2] = nz
      }
      outIdx[corner] = index
    }
  }
  return {
    positions: outPos.slice(0, count * 3),
    normals: outNrm.slice(0, count * 3),
    indices: outIdx,
  }
}

/** Crease-normal display mesh plus feature edges for a welded surface. */
export const tessellationOf = (tris: IndexedTriangles): Tessellation => ({
  mesh: creaseNormals(tris),
  edges: featureEdges(tris),
})

/** Enclosed volume of a closed, outward-wound surface (divergence theorem). */
export function meshVolume({ positions: p, indices }: IndexedTriangles): number {
  let v = 0
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3
    const b = indices[i + 1]! * 3
    const c = indices[i + 2]! * 3
    v +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
      p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)
  }
  return v / 6
}

export function meshArea(tris: IndexedTriangles): number {
  const n = faceNormals(tris)
  let a = 0
  for (let i = 0; i < n.length; i += 3) a += Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!)
  return a / 2
}

export const EMPTY_BOUNDS: Bounds = { min: [0, 0, 0], max: [0, 0, 0] }

export function boundsOfPositions(positions: Float32Array): Bounds {
  if (positions.length === 0) return EMPTY_BOUNDS
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]!
      if (v < min[k]!) min[k] = v
      if (v > max[k]!) max[k] = v
    }
  return { min, max }
}

export function unionBounds(all: readonly Bounds[]): Bounds {
  if (all.length === 0) return EMPTY_BOUNDS
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const b of all)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, b.min[k]!)
      max[k] = Math.max(max[k]!, b.max[k]!)
    }
  return { min, max }
}

export const boundsOverlap = (a: Bounds, b: Bounds, margin = 0): boolean =>
  [0, 1, 2].every((k) => a.min[k]! <= b.max[k]! + margin && b.min[k]! <= a.max[k]! + margin)

/** Applies a similarity transform to xyz triples; directions ignore translation and scale. */
function transformTriples(m: Mat4, src: Float32Array, direction: boolean): Float32Array {
  const out = new Float32Array(src.length)
  const s = direction ? Math.hypot(m[0]!, m[1]!, m[2]!) || 1 : 1
  const tx = direction ? 0 : m[12]!
  const ty = direction ? 0 : m[13]!
  const tz = direction ? 0 : m[14]!
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i]!
    const y = src[i + 1]!
    const z = src[i + 2]!
    out[i] = (m[0]! * x + m[4]! * y + m[8]! * z) / s + tx
    out[i + 1] = (m[1]! * x + m[5]! * y + m[9]! * z) / s + ty
    out[i + 2] = (m[2]! * x + m[6]! * y + m[10]! * z) / s + tz
  }
  return out
}

/** True when the matrix mirrors (negative determinant), which reverses triangle winding. */
export function isMirror(m: Mat4): boolean {
  const det =
    m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
    m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) +
    m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!)
  return det < 0
}

function orientIndices(indices: Uint32Array, flip: boolean): Uint32Array {
  if (!flip) return indices
  const out = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i += 3) {
    out[i] = indices[i]!
    out[i + 1] = indices[i + 2]!
    out[i + 2] = indices[i + 1]!
  }
  return out
}

export function transformTriangles(m: Mat4, tris: IndexedTriangles): IndexedTriangles {
  return {
    positions: transformTriples(m, tris.positions, false),
    indices: orientIndices(tris.indices, isMirror(m)),
  }
}

export function transformTessellation(m: Mat4, t: Tessellation): Tessellation {
  // A similarity's linear part is orthogonal up to scale, so it maps normals to normals — for
  // a mirror too; only the winding has to be reversed.
  return {
    mesh: {
      positions: transformTriples(m, t.mesh.positions, false),
      normals: transformTriples(m, t.mesh.normals, true),
      indices: orientIndices(t.mesh.indices, isMirror(m)),
    },
    edges: transformTriples(m, t.edges, false),
  }
}

/** Concatenates display meshes into one (indices are rebased). */
export function mergeTessellations(parts: readonly Tessellation[]): Tessellation {
  if (parts.length === 1) return parts[0]!
  let vertices = 0
  let indices = 0
  let edges = 0
  for (const p of parts) {
    vertices += p.mesh.positions.length
    indices += p.mesh.indices.length
    edges += p.edges.length
  }
  const out: Tessellation = {
    mesh: {
      positions: new Float32Array(vertices),
      normals: new Float32Array(vertices),
      indices: new Uint32Array(indices),
    },
    edges: new Float32Array(edges),
  }
  let v = 0
  let i = 0
  let e = 0
  for (const p of parts) {
    out.mesh.positions.set(p.mesh.positions, v)
    out.mesh.normals.set(p.mesh.normals, v)
    const base = v / 3
    for (let k = 0; k < p.mesh.indices.length; k++)
      out.mesh.indices[i + k] = p.mesh.indices[k]! + base
    out.edges.set(p.edges, e)
    v += p.mesh.positions.length
    i += p.mesh.indices.length
    e += p.edges.length
  }
  return out
}
