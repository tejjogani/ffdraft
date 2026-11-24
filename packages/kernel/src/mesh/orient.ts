/**
 * Consistent, outward winding. Imported meshes often mix triangle orientations (or are inside
 * out); Manifold needs every edge traversed once in each direction and positive volume.
 */
import { type IndexedTriangles, meshVolume } from '../solid/meshing'
import { edgeTopology, triangleComponents } from './topology'

function flip(indices: Uint32Array, t: number): void {
  const b = indices[t * 3 + 1]!
  indices[t * 3 + 1] = indices[t * 3 + 2]!
  indices[t * 3 + 2] = b
}

/**
 * Makes neighbouring triangles agree on winding (flood fill across two-triangle edges), then
 * turns every connected component outward (positive signed volume). Returns a new mesh and the
 * number of triangles flipped.
 */
export function orientOutward(mesh: IndexedTriangles): { mesh: IndexedTriangles; flipped: number } {
  const indices = mesh.indices.slice()
  const triangles = indices.length / 3
  const { twin } = edgeTopology(mesh)
  const flippedState = new Uint8Array(triangles)
  const visited = new Uint8Array(triangles)
  const stack: number[] = []
  for (let seed = 0; seed < triangles; seed++) {
    if (visited[seed]) continue
    visited[seed] = 1
    stack.push(seed)
    while (stack.length > 0) {
      const t = stack.pop()!
      for (let k = 0; k < 3; k++) {
        const h = t * 3 + k
        const o = twin[h]!
        if (o < 0) continue
        const n = (o / 3) | 0
        if (visited[n]) continue
        // After t's own flip, does the neighbour traverse the shared edge the same way?
        const tailT = flippedState[t] ? indices[t * 3 + ((k + 1) % 3)]! : indices[h]!
        const tailN = indices[o]!
        visited[n] = 1
        if (tailT === tailN) flippedState[n] = 1
        stack.push(n)
      }
    }
  }
  let flipped = 0
  for (let t = 0; t < triangles; t++)
    if (flippedState[t]) {
      flip(indices, t)
      flipped++
    }

  // Outward per component: a component with negative enclosed volume is inside out.
  const oriented = { positions: mesh.positions, indices }
  const { id, count } = triangleComponents(triangles, edgeTopology(oriented).twin)
  const members: number[][] = Array.from({ length: count }, () => [])
  for (let t = 0; t < triangles; t++) members[id[t]!]!.push(t)
  for (const list of members) {
    const sub = new Uint32Array(list.length * 3)
    list.forEach((t, i) => {
      sub.set(indices.subarray(t * 3, t * 3 + 3), i * 3)
    })
    if (meshVolume({ positions: mesh.positions, indices: sub }) < 0)
      for (const t of list) {
        flip(indices, t)
        flipped++
      }
  }
  return { mesh: oriented, flipped }
}
