/**
 * Taubin λ|μ smoothing: alternating shrink and inflate Laplacian steps remove the faceting and
 * noise of scans and AI meshes without the volume loss of plain Laplacian smoothing
 * (Taubin, "A signal processing approach to fair surface design", 1995).
 */
import type { Manifold } from 'manifold-3d'
import type { IndexedTriangles } from '../solid/meshing'
import { manifoldFromTriangles, trianglesFromManifold } from '../solid/solid'
import { dropSpecks } from './pieces'
import { vertexRings } from './topology'

const LAMBDA = 0.5
const MU = -0.53
/** Each step of the 0–8 schema slider runs this many λ|μ pairs. */
const PAIRS_PER_LEVEL = 3
/** Deviation allowed when thinning the smoothed mesh, per unit of refined edge length. */
const RETHIN = 0.01

export function taubinSmooth(mesh: IndexedTriangles, pairs: number): IndexedTriangles {
  const { start, list } = vertexRings(mesh)
  let p = Float64Array.from(mesh.positions)
  let next = new Float64Array(p.length)
  const step = (factor: number) => {
    const vertices = p.length / 3
    for (let v = 0; v < vertices; v++) {
      const from = start[v]!
      const to = start[v + 1]!
      for (let k = 0; k < 3; k++) {
        if (to === from) {
          next[v * 3 + k] = p[v * 3 + k]!
          continue
        }
        let sum = 0
        for (let i = from; i < to; i++) sum += p[list[i]! * 3 + k]!
        const mean = sum / (to - from)
        next[v * 3 + k] = p[v * 3 + k]! + factor * (mean - p[v * 3 + k]!)
      }
    }
    ;[p, next] = [next, p]
  }
  for (let i = 0; i < pairs; i++) {
    step(LAMBDA)
    step(MU)
  }
  return { positions: Float32Array.from(p), indices: mesh.indices }
}

/**
 * Smooths a Manifold body by `level` (0–8), first refined to edges no longer than `edge`. The
 * umbrella operator moves each vertex toward the mean of its neighbours, so it only behaves
 * like curvature flow on an even mesh: on a CAD export or a hull, whose flat faces are a few
 * long slivers, corners are dragged across whole faces and the faces crumple. The caller owns
 * the result.
 */
export function smoothManifold(m: Manifold, level: number, edge: number): Manifold {
  if (level <= 0) return m
  const even = m.refineToLength(edge)
  const smooth = manifoldFromTriangles(
    taubinSmooth(trianglesFromManifold(even), level * PAIRS_PER_LEVEL),
  )
  even.delete()
  // The refinement is only needed while smoothing: thin it again wherever the surface stayed
  // flat, within a deviation far below casting resolution.
  try {
    return dropSpecks(smooth.simplify(edge * RETHIN))
  } finally {
    smooth.delete()
  }
}
