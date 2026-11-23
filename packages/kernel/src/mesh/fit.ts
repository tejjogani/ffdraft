/**
 * Sizing and placement of sculpted bodies: scaled to an overall height, then stood in the
 * kernel's convention for flat pieces — centred left-right and top-bottom, back on y = 0, the
 * face toward −Y (see the space note in packages/schema/src/design/nodes.ts).
 */
import type { Manifold } from 'manifold-3d'

/** Uniformly scales so the Z extent equals `height` (the caller owns the result). */
export function scaleToHeight(m: Manifold, height: number): Manifold {
  const box = m.boundingBox()
  const extent = box.max[2] - box.min[2]
  if (!(extent > 0)) throw new Error('The mesh is flat in Z, so it has no height to scale')
  return m.scale(height / extent)
}

/** The move that centres the body's bounds in X and Z and puts its back (max Y) on y = 0. */
export function flatPlacement(m: Manifold): [number, number, number] {
  const box = m.boundingBox()
  return [-(box.min[0] + box.max[0]) / 2, -box.max[1], -(box.min[2] + box.max[2]) / 2]
}

/**
 * Slices `fraction` of the depth off the back so the piece lies flat on the chest. Returns the
 * kept part, or the input itself when there is nothing to cut.
 */
export function flatBack(m: Manifold, fraction: number): Manifold {
  if (fraction <= 0) return m
  const box = m.boundingBox()
  const plane = box.max[1] - fraction * (box.max[1] - box.min[1])
  // Keep y ≤ plane: the half-space the normal (0, −1, 0) points into.
  return m.trimByPlane([0, -1, 0], -plane)
}
