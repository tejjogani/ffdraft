/**
 * Connectivity of welded triangle meshes: half-edge twins, open boundaries, vertex rings and
 * connected components. Everything the repair, smoothing and sampling steps need to know about
 * how triangles fit together.
 */
import type { IndexedTriangles } from '../solid/meshing'

export interface EdgeTopology {
  /**
   * The other half-edge of the same edge (3·t + k runs from corner k to corner k+1), or -1 when
   * the edge is open or shared by more than two triangles. Twins may run the same direction
   * when the winding is inconsistent.
   */
  twin: Int32Array
  /** Edges shared by more than two triangles. */
  nonManifold: number
  /** Half-edges with no twin. */
  open: number
  /** Twinned edges whose two triangles disagree on winding. */
  inconsistent: number
}

export function edgeTopology({ positions, indices }: IndexedTriangles): EdgeTopology {
  const vertices = positions.length / 3
  const halfEdges = indices.length
  const twin = new Int32Array(halfEdges).fill(-1)
  const uses = new Map<number, number[]>()
  for (let h = 0; h < halfEdges; h++) {
    const a = indices[h]!
    const b = headOf(indices, h)
    const key = a < b ? a * vertices + b : b * vertices + a
    const list = uses.get(key)
    if (list) list.push(h)
    else uses.set(key, [h])
  }
  let nonManifold = 0
  let inconsistent = 0
  for (const list of uses.values()) {
    if (list.length > 2) nonManifold++
    if (list.length !== 2) continue
    const [h, o] = list as [number, number]
    twin[h] = o
    twin[o] = h
    if (indices[h] === indices[o]) inconsistent++
  }
  let open = 0
  for (let h = 0; h < halfEdges; h++) if (twin[h]! < 0) open++
  return { twin, nonManifold, open, inconsistent }
}

/** End vertex of half-edge h. */
export const headOf = (indices: Uint32Array, h: number): number =>
  indices[h - (h % 3) + ((h + 1) % 3)]!

/**
 * Closed loops of open half-edges, each as the vertex sequence along the boundary. Boundaries
 * that pinch at a vertex are split into separate loops.
 */
export function boundaryLoops(mesh: IndexedTriangles, twin: Int32Array): number[][] {
  const { indices } = mesh
  const next = new Map<number, number[]>()
  for (let h = 0; h < indices.length; h++)
    if (twin[h]! < 0) {
      // The hole runs opposite to the triangle's edge: head → tail.
      const from = headOf(indices, h)
      const list = next.get(from)
      if (list) list.push(indices[h]!)
      else next.set(from, [indices[h]!])
    }
  const loops: number[][] = []
  for (const start of [...next.keys()].sort((a, b) => a - b)) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const loop = [start]
      let v = next.get(start)!.pop()!
      let guard = 0
      while (v !== start && guard++ < indices.length) {
        loop.push(v)
        const out = next.get(v)
        if (!out || out.length === 0) break
        v = out.pop()!
      }
      if (v === start && loop.length >= 3) loops.push(loop)
    }
  }
  return loops
}

/** Compressed vertex adjacency: neighbours of v are `list[start[v] .. start[v+1])`. */
export interface VertexRings {
  start: Uint32Array
  list: Uint32Array
}

export function vertexRings({ positions, indices }: IndexedTriangles): VertexRings {
  const vertices = positions.length / 3
  const seen = new Set<number>()
  const pairs: number[] = []
  for (let t = 0; t < indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k]!
      const b = indices[t + ((k + 1) % 3)]!
      const key = a < b ? a * vertices + b : b * vertices + a
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push(a, b)
    }
  const start = new Uint32Array(vertices + 1)
  for (const v of pairs) start[v + 1]!++
  for (let v = 0; v < vertices; v++) start[v + 1]! += start[v]!
  const fill = start.slice(0, vertices)
  const list = new Uint32Array(pairs.length)
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i]!
    const b = pairs[i + 1]!
    list[fill[a]!++] = b
    list[fill[b]!++] = a
  }
  return { start, list }
}

/** Connected component id per triangle (through shared edges with a twin). */
export function triangleComponents(
  triangles: number,
  twin: Int32Array,
): { id: Int32Array; count: number } {
  const id = new Int32Array(triangles).fill(-1)
  let count = 0
  const stack: number[] = []
  for (let seed = 0; seed < triangles; seed++) {
    if (id[seed]! >= 0) continue
    id[seed] = count
    stack.push(seed)
    while (stack.length > 0) {
      const t = stack.pop()!
      for (let k = 0; k < 3; k++) {
        const o = twin[t * 3 + k]!
        if (o < 0) continue
        const n = (o / 3) | 0
        if (id[n]! < 0) {
          id[n] = count
          stack.push(n)
        }
      }
    }
    count++
  }
  return { id, count }
}
