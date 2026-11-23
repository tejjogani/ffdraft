/**
 * Last-resort repair: rebuild the surface as the zero level set of a signed distance field.
 * Works on anything that roughly encloses a volume — non-manifold fans, self-intersections,
 * overlapping shells, holes — at the cost of detail finer than the grid (docs/research/
 * 06-freeform.md §4 recommends 0.05–0.1 mm on a server; in the browser we trade that for time).
 */
import type { Manifold } from 'manifold-3d'
import type { IndexedTriangles } from '../solid/meshing'
import { boundsOfPositions } from '../solid/meshing'
import { distanceGrid, levelSetOf } from './sdf'

/** Grid cells across the largest dimension: ~0.3 mm on a 45 mm pendant, a few seconds of work. */
const CELLS_ACROSS = 150
const MIN_SPACING = 0.05

export function resurface(mesh: IndexedTriangles): Manifold {
  const b = boundsOfPositions(mesh.positions)
  const extent = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
  const spacing = Math.max(extent / CELLS_ACROSS, MIN_SPACING)
  const grid = distanceGrid(mesh, { spacing, band: 3 * spacing, votes: 3 })
  const result = levelSetOf(grid, 0)
  if (result.isEmpty()) {
    result.delete()
    throw new Error(
      'The mesh does not enclose a volume, so it cannot be made solid. Export it as a closed ' +
        '(watertight) model, or close its open edges in the modelling tool, and import it again.',
    )
  }
  return result
}
