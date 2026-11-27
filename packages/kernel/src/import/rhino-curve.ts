import { type NurbsControlPoint, NurbsDefinition } from '@pave/schema'
import type { Curve, NurbsCurve, RhinoModule } from 'rhino3dm'
import { freeRhino } from '../runtime/rhino'
import type { Bounds } from '../types'

export const CURVE_SOURCE_ID_KEY = 'paveSourceObjectId'
const MAX_DEGREE = 15
const MAX_CONTROL_POINTS = 4096
const TOO_COMPLEX = `Use Rebuild in Rhino to reduce the curve to degree ${MAX_DEGREE} or less and at most ${MAX_CONTROL_POINTS} control points.`

export class RhinoCurveReadError extends Error {}

export interface PlacedRhinoCurve {
  degree: number
  knots: number[]
  controlPoints: NurbsControlPoint[]
  bounds: Bounds
  converted: boolean
}

/** Convert native geometry to a standalone, placed curve without modifying the source object. */
export function readPlacedCurve(
  rhino: RhinoModule,
  source: Curve,
  place: (point: number[]) => number[],
): PlacedRhinoCurve {
  if (source.degree > MAX_DEGREE || source.spanCount >= MAX_CONTROL_POINTS)
    throw new RhinoCurveReadError(TOO_COMPLEX)
  if (source instanceof rhino.PolyCurve && source.hasGap)
    throw new RhinoCurveReadError(
      'The Rhino PolyCurve has gaps between its segments. Export the segments separately.',
    )
  if (!source.isValid)
    throw new RhinoCurveReadError('The Rhino curve is invalid. Repair or rebuild it in Rhino.')
  const converted = !(source instanceof rhino.NurbsCurve)
  const curve = converted ? source.toNurbsCurve() : (source.duplicate() as NurbsCurve)
  if (!curve)
    throw new RhinoCurveReadError(
      'Rhino could not convert the curve to NURBS. Rebuild it in Rhino and save again.',
    )
  try {
    if (!curve.isValid || curve.dimension !== 3)
      throw new RhinoCurveReadError(
        'The Rhino curve could not convert to valid 3D NURBS. Rebuild it in Rhino.',
      )
    const points = curve.points()
    const knots = curve.knots()
    try {
      if (curve.degree > MAX_DEGREE || points.count > MAX_CONTROL_POINTS)
        throw new RhinoCurveReadError(TOO_COMPLEX)
      const domain = source.domain
      if (domain.some((value, end) => value !== curve.domain[end])) curve.domain = domain
      const rational = curve.isRational
      const controlPoints = Array.from({ length: points.count }, (_, index): NurbsControlPoint => {
        const [wx, wy, wz, w] = points.get(index)
        // OpenNURBS stores homogeneous coordinates. Apply the affine placement in Euclidean
        // space, so world translation is weighted correctly when the curve is serialized again.
        const weight = rational ? w! : 1
        const [x, y, z] = place([wx! / weight, wy! / weight, wz! / weight])
        return [x!, y!, z!, weight]
      })
      const parsed = NurbsDefinition.safeParse({
        degree: curve.degree,
        knots: knots.toList(),
        controlPoints,
      })
      if (!parsed.success)
        throw new RhinoCurveReadError(
          'The curve has unsupported knots, weights or coordinates. Check it in Rhino and save again.',
        )
      for (const [index, [x, y, z, w]] of controlPoints.entries()) {
        points.set(index, [x * w, y * w, z * w, w])
      }
      const box = curve.getBoundingBox(true)
      try {
        if (!box.isValid) throw new RhinoCurveReadError('The curve has no finite bounds.')
        const [minX, minY, minZ] = box.min
        const [maxX, maxY, maxZ] = box.max
        return {
          ...parsed.data,
          bounds: { min: [minX!, minY!, minZ!], max: [maxX!, maxY!, maxZ!] },
          converted,
        }
      } finally {
        freeRhino(box)
      }
    } finally {
      freeRhino(knots)
      freeRhino(points)
    }
  } finally {
    freeRhino(curve)
  }
}
