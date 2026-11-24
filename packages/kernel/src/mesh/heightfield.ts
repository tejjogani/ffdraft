/** A height field as a closed solid: a grid surface on top, a flat bottom, vertical sides. */
import type { Manifold } from 'manifold-3d'
import { manifoldFromTriangles } from '../solid/solid'

export interface HeightGrid {
  /** Position of grid node (0, 0) and the node spacing, mm. */
  x0: number
  y0: number
  spacing: number
  nx: number
  ny: number
  /** Top height per node, row-major (y rows of x). */
  z: Float32Array
}

/** The solid between z = `bottom` and the grid surface. The caller owns the result. */
export function heightfieldSolid(grid: HeightGrid, bottom: number): Manifold {
  const { nx, ny, spacing, x0, y0 } = grid
  if (nx < 2 || ny < 2) throw new Error('A height field needs at least 2 × 2 samples')
  const n = nx * ny
  const positions = new Float32Array(n * 6)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const x = x0 + i * spacing
      const y = y0 + j * spacing
      positions.set([x, y, Math.max(grid.z[k]!, bottom + 1e-3)], k * 3)
      positions.set([x, y, bottom], (n + k) * 3)
    }
  const indices: number[] = []
  const top = (i: number, j: number) => j * nx + i
  const low = (i: number, j: number) => n + j * nx + i
  for (let j = 0; j + 1 < ny; j++)
    for (let i = 0; i + 1 < nx; i++) {
      indices.push(
        top(i, j),
        top(i + 1, j),
        top(i + 1, j + 1),
        top(i, j),
        top(i + 1, j + 1),
        top(i, j + 1),
      )
      indices.push(
        low(i, j),
        low(i + 1, j + 1),
        low(i + 1, j),
        low(i, j),
        low(i, j + 1),
        low(i + 1, j + 1),
      )
    }
  // Side walls along the four borders; walking a → b, the outside is on the right.
  const wall = (a: [number, number], b: [number, number]) =>
    indices.push(top(...a), low(...a), low(...b), top(...a), low(...b), top(...b))
  for (let i = 0; i + 1 < nx; i++) {
    wall([i, 0], [i + 1, 0])
    wall([i + 1, ny - 1], [i, ny - 1])
  }
  for (let j = 0; j + 1 < ny; j++) {
    wall([0, j + 1], [0, j])
    wall([nx - 1, j], [nx - 1, j + 1])
  }
  return manifoldFromTriangles({ positions, indices: Uint32Array.from(indices) })
}
