/**
 * Imported triangles → one closed, outward, watertight Manifold.
 *
 * The cheap path fixes what most files get wrong: unwelded seams, duplicate and degenerate
 * faces, mixed winding, small holes and overlapping shells. Anything still not a 2-manifold
 * (edges shared by three or more faces, non-orientable patches) is re-surfaced through a signed
 * distance field instead; the caller reports that, because fine detail can be lost.
 */
import type { Manifold } from 'manifold-3d'
import { runtime } from '../runtime/index'
import { type IndexedTriangles, boundsOfPositions } from '../solid/meshing'
import { manifoldFromTriangles } from '../solid/solid'
import { fillHoles } from './fill'
import { orientOutward } from './orient'
import { resurface } from './resurface'
import { edgeTopology } from './topology'
import { weldWithin } from './weld'

export interface RepairReport {
  /** Vertices merged by welding. */
  merged: number
  /** Holes capped. */
  holes: number
  /** Triangles whose winding was reversed. */
  flipped: number
  /** Overlapping shells fused into one. */
  shells: number
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
  const report: RepairReport = { merged: 0, holes: 0, flipped: 0, shells: 0, resurfaced: false }
  const inputVertices = soup.positions.length / 3

  let mesh = weldWithin(soup, diagonal * WELD_FINE)
  let topology = edgeTopology(mesh)
  if (topology.open > 0) {
    mesh = weldWithin(mesh, diagonal * WELD_COARSE)
    topology = edgeTopology(mesh)
  }
  report.merged = inputVertices - mesh.positions.length / 3

  const rebuild = (): { manifold: Manifold; report: RepairReport } => {
    report.resurfaced = true
    return { manifold: resurface(mesh), report }
  }
  if (topology.nonManifold > 0) return rebuild()

  const first = orientOutward(mesh)
  const filled = fillHoles(first.mesh)
  const closed = orientOutward(filled.mesh)
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
  return { manifold: fused.manifold, report }
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
