import type { Brep, RhinoModule } from 'rhino3dm'
import {
  composeTransform,
  cross,
  dot,
  IDENTITY,
  length,
  type Mat4,
  multiply,
  scale,
  transformPoint,
  type Vec3,
} from '../geometry/vec'
import { freeRhino, loadRhino3dm } from '../runtime/rhino'
import { MAX_RHINO_FILE_BYTES } from './rhino'

export type RhinoPoint = [number, number, number]
export type HoldRhino = <T extends object | null>(value: T) => T

export interface RhinoPlacement {
  nativeTransform?: Mat4
  projectTransform?: { position: Vec3; rotation: Vec3; scale: number }
}

export function withRhinoHandles<T>(read: (hold: HoldRhino) => T): T {
  const handles: object[] = []
  try {
    return read((value) => {
      if (value) handles.push(value)
      return value
    })
  } finally {
    for (const value of handles.reverse()) freeRhino(value)
  }
}

function xyz(p: readonly number[]): RhinoPoint {
  return [p[0]!, p[1]!, p[2]!]
}

function placementSign(matrix: Mat4): number {
  if (
    matrix.length !== 16 ||
    Array.from(matrix).some((value) => !Number.isFinite(value)) ||
    matrix[3] !== 0 ||
    matrix[7] !== 0 ||
    matrix[11] !== 0 ||
    matrix[15] !== 1
  )
    throw new Error('The Rhino source has an invalid placement.')
  const basis = [0, 4, 8].map((i) => xyz(matrix.slice(i, i + 3)))
  const norms = basis.map(length)
  if (norms.some((value) => !Number.isFinite(value) || value <= 1e-12))
    throw new Error('The Rhino source placement collapses geometry.')
  const [a, b, c] = basis.map((axis, i) => scale(axis, 1 / norms[i]!)) as [Vec3, Vec3, Vec3]
  const orientation = dot(a, cross(b, c))
  if (Math.abs(orientation) <= 1e-12)
    throw new Error('The Rhino source placement collapses geometry.')
  return Math.sign(orientation)
}

/** Place retained Rhino geometry from source millimetres into project millimetres. */
export function rhinoPlacement({ nativeTransform = IDENTITY, projectTransform }: RhinoPlacement) {
  const sourceSign = placementSign(nativeTransform)
  const matrix = projectTransform
    ? multiply(
        composeTransform(
          projectTransform.position,
          projectTransform.rotation,
          projectTransform.scale,
        ),
        nativeTransform,
      )
    : nativeTransform
  return {
    reflected: (projectTransform ? placementSign(matrix) : sourceSign) < 0,
    place(p: readonly number[]): RhinoPoint {
      const result = xyz(transformPoint(matrix, xyz(p)))
      if (!result.every(Number.isFinite))
        throw new Error('The Rhino source has invalid coordinates.')
      return result
    },
  }
}

export async function readRetainedRhinoSolid<T>(
  bytes: Uint8Array,
  inspect: (rhino: RhinoModule, part: Brep, hold: HoldRhino) => T,
): Promise<T | null> {
  if (bytes.byteLength > MAX_RHINO_FILE_BYTES) throw new Error('The Rhino source is too large.')
  const rhino = await loadRhino3dm()
  return withRhinoHandles((hold) => {
    const document = hold(rhino.File3dm.fromByteArray(bytes))
    if (!document) return null
    const objects = hold(document.objects())
    if (
      objects.count !== 1 ||
      hold(document.settings()).modelUnitSystem !== rhino.UnitSystem.Millimeters
    )
      return null
    const part = hold(hold(objects.get(0)).geometry())
    if (!(part instanceof rhino.Brep) || !part.isValid || !part.isSolid) return null
    return inspect(rhino, part, hold)
  })
}
