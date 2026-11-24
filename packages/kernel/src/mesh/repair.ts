/**
 * Imported triangles → one closed, outward, watertight Manifold.
 *
 * The cheap path fixes what most files get wrong: unwelded seams, duplicate and degenerate
 * faces, stray fragments, mixed winding, small holes and overlapping shells. Anything still not a 2-manifold
 * (edges shared by three or more faces, non-orientable patches) is re-surfaced through a signed
 * distance field instead; the caller reports that, because fine detail can be lost.
 */
import type { Manifold } from 'manifold-3d'
import { runtime } from '../runtime/index'
import { boundsOfPositions, type IndexedTriangles } from '../solid/meshing'
import { manifoldFromTriangles } from '../solid/solid'
import { fillHoles } from './fill'
import { orientOutward } from './orient'
import { resurface } from './resurface'
import { edgeTopology, triangleComponents } from './topology'
import { compact, weldWithin } from './weld'

export interface RepairReport {
  /** Vertices merged by welding. */
  merged: number
  /** Holes capped. */
  holes: number
  /** Triangles whose winding was reversed. */
  flipped: number
  /** Overlapping shells fused into one. */
  shells: number
  /** Small loose open pieces (stray faces, fins) removed. */
  fragments: number
  /** The surface was rebuilt from a distance field (detail finer than the grid is lost). */
  resurfaced: boolean
}

/** Seam tolerance relative to the model size: float noise first, then small cracks. */
const WELD_FINE = 1e-6
const WELD_COARSE = 2e-4

export function repairMesh(soup: IndexedTriangles): { manifold: Manifold; report: RepairReport } {
  if (soup.indices.length < 12) throw new Error('The mesh has too few triangles to form a solid')
  const b = boundsOfPositions(soup.positions)
  const diagonal = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
  const report: RepairReport = {
    merged: 0,
    holes: 0,
    flipped: 0,
    shells: 0,
    fragments: 0,
    resurfaced: false,
  }
  const inputVertices = soup.positions.length / 3

  let mesh = weldWithin(soup, diagonal * WELD_FINE)
  if (edgeTopology(mesh).open > 0) mesh = weldWithin(mesh, diagonal * WELD_COARSE)
  report.merged = inputVertices - mesh.positions.length / 3

  const first = orientOutward(mesh)
  const kept = dropFragments(first.mesh)
  report.fragments = kept.dropped
  const filled = fillHoles(kept.mesh)
  const closed = orientOutward(filled.mesh)
  const rebuild = (): { manifold: Manifold; report: RepairReport } => {
    report.resurfaced = true
    return { manifold: resurface(closed.mesh), report }
  }
  report.holes = filled.holes
  report.flipped = first.flipped + closed.flipped
  const check = edgeTopology(closed.mesh)
  if (check.open > 0 || check.nonManifold > 0 || check.inconsistent > 0) return rebuild()

  let manifold: Manifold
  try {
    manifold = manifoldFromTriangles(closed.mesh)
  } catch {
    return rebuild()
  }
  const fused = fuseShells(manifold)
  report.shells = fused.shells
  // A closed surface around no volume (a capped flat sheet) is not a solid either.
  if (!(fused.manifold.volume() > 1e-9 * diagonal ** 3)) {
    fused.manifold.delete()
    return rebuild()
  }
  return { manifold: fused.manifold, report }
}

/** Open pieces with fewer than this share of the triangles are debris, not part of the model. */
const FRAGMENT = 0.005

/**
 * Removes small connected pieces that have an open boundary — stray faces and fins left by
 * exporters. Closed pieces are kept however small (they may be real parts).
 */
function dropFragments(mesh: IndexedTriangles): { mesh: IndexedTriangles; dropped: number } {
  const triangles = mesh.indices.length / 3
  const { twin } = edgeTopology(mesh)
  const { id, count } = triangleComponents(triangles, twin)
  const size = new Uint32Array(count)
  const open = new Uint8Array(count)
  for (let t = 0; t < triangles; t++) {
    size[id[t]!]!++
    for (let k = 0; k < 3; k++) if (twin[t * 3 + k]! < 0) open[id[t]!] = 1
  }
  const limit = Math.max(4, FRAGMENT * triangles)
  const drop = (c: number) => open[c] === 1 && size[c]! < limit
  let dropped = 0
  for (let c = 0; c < count; c++) if (drop(c)) dropped++
  if (dropped === 0) return { mesh, dropped }
  const indices: number[] = []
  for (let t = 0; t < triangles; t++)
    if (!drop(id[t]!))
      indices.push(mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!)
  return { mesh: compact(mesh.positions, Uint32Array.from(indices)), dropped }
}

/** Unions separate shells (overlapping parts of a model); inside-out leftovers are dropped. */
function fuseShells(manifold: Manifold): { manifold: Manifold; shells: number } {
  const parts = manifold.decompose()
  if (parts.length <= 1) {
    for (const p of parts) p.delete()
    return { manifold, shells: 0 }
  }
  const { manifold: mf } = runtime()
  const solid = parts.filter((p) => p.volume() > 0)
  const fused = mf.Manifold.union(solid)
  for (const p of parts) p.delete()
  manifold.delete()
  return { manifold: fused, shells: solid.length }
}
