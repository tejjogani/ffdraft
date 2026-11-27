import type { MountCage } from './nodes'

type Point = [number, number, number]
type Columns = [Point, Point, Point]
const AXES = [0, 1, 2] as const
const CORNERS = [0, 1, 2, 3, 4, 5, 6, 7] as const
const bit = (corner: number, axis: number) => (corner >> axis) & 1
// A little headroom for placed mesh coordinates stored at single precision.
const DOMAIN_MARGIN = 1e-6

const vector = (value: (axis: (typeof AXES)[number]) => number): Point => [
  value(0),
  value(1),
  value(2),
]
const span = (cage: MountCage): Point => vector((i) => cage.max[i] - cage.min[i])
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

function jacobian(cage: MountCage, size: Point, at: Point): Columns {
  const column = (axis: (typeof AXES)[number]) => {
    const delta = vector((row) => (axis === row ? 1 : 0))
    const mask = 1 << axis
    for (const corner of CORNERS) {
      if (corner & mask) continue
      let weight = 1 / size[axis]
      for (const other of AXES) {
        if (other !== axis) weight *= bit(corner, other) ? at[other] : 1 - at[other]
      }
      for (const row of AXES)
        delta[row] += weight * (cage.offsets[corner | mask]![row] - cage.offsets[corner][row])
    }
    return delta
  }
  return [column(0), column(1), column(2)]
}

/** True when corner displacements all come from one translation and a constant linear map. */
export function mountCageIsAffine({ offsets }: MountCage): boolean {
  return AXES.every((axis) => {
    const first = offsets[0][axis]
    const next = vector((input) => offsets[1 << input]![axis] - first)
    const error = 32 * Number.EPSILON * Math.max(1, ...offsets.map((o) => Math.abs(o[axis])))
    return CORNERS.every((corner) => {
      const predicted =
        first +
        dot(
          next,
          vector((input) => bit(corner, input)),
        )
      return Math.abs(predicted - offsets[corner][axis]) <= error
    })
  })
}

/** Column-major transform of the placed original geometry for a cage known to be affine. */
export function mountCageAffine(cage: MountCage): number[] {
  const [x, y, z] = jacobian(cage, span(cage), [0, 0, 0])
  const translation = vector(
    (i) => cage.min[i] + cage.offsets[0][i] - dot([x[i], y[i], z[i]], cage.min),
  )
  return [...x, 0, ...y, 0, ...z, 0, ...translation, 1]
}

function cageDisplacement(cage: MountCage, at: Point): Point {
  const moved: Point = [0, 0, 0]
  for (const corner of CORNERS) {
    const weight = AXES.reduce<number>((w, i) => w * (bit(corner, i) ? at[i] : 1 - at[i]), 1)
    for (const i of AXES) moved[i] += weight * cage.offsets[corner][i]
  }
  return moved
}

/** Map a point in the original placed geometry by the eight corner offsets. */
export function mountCagePoint(cage: MountCage, point: readonly [number, number, number]): Point {
  const at = vector((i) => (point[i] - cage.min[i]) / (cage.max[i] - cage.min[i]))
  const moved = cageDisplacement(cage, at)
  return vector((i) => point[i] + moved[i])
}

/** Tangent affine placement for a separate solid, evaluated at its original world centre. */
export function mountCageForPart(
  cage: MountCage,
  center: readonly [number, number, number],
): MountCage {
  if (cage.mode !== 'byPart' || mountCageIsAffine(cage)) return cage
  const size = span(cage)
  const at = vector((i) => (center[i] - cage.min[i]) / size[i])
  const jac = jacobian(cage, size, at)
  const steps = (row: number) => vector((i) => (jac[i][row]! - (i === row ? 1 : 0)) * size[i])
  const displacement = cageDisplacement(cage, at)
  const baseOffset = vector((i) => displacement[i] - dot(steps(i), at))
  const offset = (corner: number): Point =>
    vector(
      (i) =>
        baseOffset[i] +
        dot(
          steps(i),
          vector((k) => bit(corner, k)),
        ),
    )
  return {
    min: cage.min,
    max: cage.max,
    offsets: [
      offset(0),
      offset(1),
      offset(2),
      offset(3),
      offset(4),
      offset(5),
      offset(6),
      offset(7),
    ],
  }
}

export function mountCageContains(
  cage: MountCage,
  point: readonly [number, number, number],
): boolean {
  return AXES.every((i) => {
    const margin = (cage.max[i] - cage.min[i]) * DOMAIN_MARGIN
    return point[i] >= cage.min[i] - margin && point[i] <= cage.max[i] + margin
  })
}

export function mountCageIsSafe(cage: MountCage): boolean {
  const size = span(cage)
  if (!size.every((s) => s > 0 && Number.isFinite(s))) return false
  const [x, y, z] = jacobian(cage, size, [0.5, 0.5, 0.5])
  const cofactors = [cross(y, z), cross(z, x), cross(x, y)]
  const det = dot(x, cofactors[0]!)
  if (!(det > 0 && Number.isFinite(det))) return false
  const inverse = cofactors.map((row) => vector((i) => row[i] / det))
  if (inverse.some((row) => !(Math.hypot(...row) < 1e6))) return false

  // Factor out the affine derivative A at the centre. Each entry of A^-1 J - I is
  // multi-affine, so its absolute maximum over the box is bounded by the eight corners.
  // A bound below 1 on its infinity norm proves the residual displacement is a contraction,
  // hence the map is injective and its Jacobian never flips sign anywhere in the box.
  const derivatives = CORNERS.map((corner) =>
    jacobian(
      cage,
      size,
      vector((i) => (bit(corner, i) ? 1 + DOMAIN_MARGIN : -DOMAIN_MARGIN)),
    ),
  )
  return inverse.every(
    (row, i) =>
      AXES.reduce<number>(
        (sum, j) =>
          sum + Math.max(...derivatives.map((d) => Math.abs(dot(row, d[j]) - (i === j ? 1 : 0)))),
        0,
      ) <
      1 - 1e-6,
  )
}
