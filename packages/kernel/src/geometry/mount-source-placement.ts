import {
  type Design,
  type MountMember,
  mountCageAffine,
  mountCageForPart,
  mountCageIsAffine,
} from '@pave/schema'
import { mountFitToGemMatrix } from './mount-fit'
import { composeTransform, IDENTITY, type Mat4, multiply, type Vec3 } from './vec'

/** Maps an exact sidecar's source coordinates through occurrence, node, cage and gem placement. */
export function mountSourcePlacement(
  design: Design,
  body: MountMember,
  originalCenter: Vec3,
): Mat4 | null {
  const { transform: t, mountFit, source, mountCage } = body
  let matrix: Mat4 = source.nativeTransform ?? IDENTITY
  if (t) matrix = multiply(composeTransform(t.position, t.rotation, t.scale), matrix)
  if (mountCage) {
    const cage = mountCageForPart(mountCage, originalCenter)
    if (!mountCageIsAffine(cage)) return null
    matrix = multiply(mountCageAffine(cage), matrix)
  }
  if (mountFit) {
    const gem = design.nodes[mountFit.gem]
    if (gem?.kind !== 'gem') return null
    matrix = multiply(mountFitToGemMatrix(mountFit, gem), matrix)
  }
  return matrix
}
