/** Search trees for the checks, built once per mesh and reused while the mesh is. */
import type { IndexedTriangles } from '../core'
import { type ClosestHit, TriangleBvh } from '../mesh/bvh'

/**
 * By mesh object. A part that did not change keeps its mesh object from one evaluation to the
 * next, so a slider drag elsewhere does not rebuild the tree of a 180k-triangle chain (100 ms
 * on every draft edit). Entries go with their meshes.
 */
const trees = new WeakMap<IndexedTriangles, TriangleBvh>()

export function treeOf(mesh: IndexedTriangles): TriangleBvh {
  let tree = trees.get(mesh)
  if (!tree) {
    tree = new TriangleBvh(mesh)
    trees.set(mesh, tree)
  }
  return tree
}

/**
 * Whether a point is inside the closed, outward-wound surface a tree was built on: the nearest
 * surface point faces away from it. One nearest-point query, where a ray to infinity crossed
 * thousands of pavé facets on a large casting; good everywhere but within a hair of a sharp
 * edge, which is not where the checks ask.
 */
export function insideSurface(tree: TriangleBvh, p: readonly number[]): boolean {
  const hit: ClosestHit = { d2: 0, x: 0, y: 0, z: 0, triangle: 0 }
  if (!tree.closest(p[0]!, p[1]!, p[2]!, hit)) return false
  const { positions: v, indices } = tree.mesh
  const a = indices[hit.triangle * 3]! * 3
  const b = indices[hit.triangle * 3 + 1]! * 3
  const c = indices[hit.triangle * 3 + 2]! * 3
  const u = [v[b]! - v[a]!, v[b + 1]! - v[a + 1]!, v[b + 2]! - v[a + 2]!]
  const w = [v[c]! - v[a]!, v[c + 1]! - v[a + 1]!, v[c + 2]! - v[a + 2]!]
  const n = [
    u[1]! * w[2]! - u[2]! * w[1]!,
    u[2]! * w[0]! - u[0]! * w[2]!,
    u[0]! * w[1]! - u[1]! * w[0]!,
  ]
  return n[0]! * (p[0]! - hit.x) + n[1]! * (p[1]! - hit.y) + n[2]! * (p[2]! - hit.z) < 0
}
