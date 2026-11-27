import { z } from 'zod'
import type { Node, NodeOf } from './nodes'
import { pointOnNurbs } from './nurbs'
import { DrawnProfile, PROFILE_PLANES, type ProfilePlane } from './profile'

export const CURVE_POINT_LIMIT = 128
export type CurvePlane = ProfilePlane
export type CurveCoordinates = [number, number]

const coordinate = z.number().min(-250).max(250)
export const CurvePoint = z.object({
  id: z.string().min(1).max(80),
  u: coordinate.meta({ title: 'Horizontal (mm)' }),
  v: coordinate.meta({ title: 'Vertical (mm)' }),
})
export type CurvePoint = z.infer<typeof CurvePoint>

export const CurveDefinition = z
  .object({
    plane: z.enum(PROFILE_PLANES).meta({ title: 'Drawing plane' }),
    planeOffset: coordinate.optional().meta({
      title: 'Plane position (mm)',
      description: 'World Y on Front, Z on Top or X on Right. Defaults to 0 mm.',
    }),
    points: z.array(CurvePoint).min(2).max(CURVE_POINT_LIMIT).meta({
      title: 'Curve points',
      description:
        'Ordered vertices with stable ids and horizontal and vertical coordinates in mm.',
    }),
    closed: z.boolean().default(false).meta({ title: 'Closed curve' }),
  })
  .superRefine(({ points, closed }, ctx) => {
    const unique = new Set(points.map(({ u, v }) => `${u},${v}`))
    const duplicateIds = new Set(points.map(({ id }) => id)).size !== points.length
    const repeated = points.some(
      (p, i) => i > 0 && p.u === points[i - 1]!.u && p.v === points[i - 1]!.v,
    )
    const first = points[0]
    const last = points.at(-1)
    let message: string | undefined
    if (closed && unique.size < 3) message = 'A closed curve needs at least three different points.'
    else if (points.length < 2) message = 'Add at least two points.'
    else if (duplicateIds) message = 'Every curve point needs its own id.'
    else if (repeated || (closed && first?.u === last?.u && first?.v === last?.v))
      message = 'Consecutive curve points must be in different places.'
    if (message) ctx.addIssue({ code: 'custom', path: ['points'], message })
  })

export function sectionIsClosed(curve: NodeOf<'curve'> | NodeOf<'nurbsCurve'>): boolean {
  if (curve.kind === 'curve') return curve.closed
  const start = pointOnNurbs(curve, curve.knots[curve.degree - 1]!)
  const end = pointOnNurbs(curve, curve.knots[curve.controlPoints.length - 1]!)
  return Math.hypot(start[0] - end[0], start[1] - end[1], start[2] - end[2]) <= 1e-7
}

export function pointFromCurvePlane(
  plane: CurvePlane,
  [u, v]: CurveCoordinates,
  offset = 0,
): [number, number, number] {
  if (plane === 'front') return [u, offset, v]
  if (plane === 'right') return [offset, u, v]
  return [u, v, offset]
}

export function pointOnCurvePlane(
  plane: CurvePlane,
  [x, y, z]: [number, number, number],
): CurveCoordinates {
  if (plane === 'front') return [x, z]
  if (plane === 'right') return [y, z]
  return [x, y]
}

/** The resolved centreline for either wire source, in the pipe's pre-transform millimetres. */
export function pipePath(
  pipe: NodeOf<'pipe'>,
  source?: Node,
): { points: [number, number, number][]; closed: boolean; plane?: CurvePlane } | null {
  if (pipe.curve === undefined)
    return pipe.points ? { points: pipe.points, closed: pipe.closed } : null
  if (source?.kind !== 'curve' || source.id !== pipe.curve) return null
  return {
    points: source.points.map(({ u, v }) =>
      pointFromCurvePlane(source.plane, [u, v], source.planeOffset),
    ),
    closed: source.closed,
    plane: source.plane,
  }
}

/** A profile must bound one face entirely on one side of the in-plane rotation axis. */
export function revolveProfileError(
  curve: NodeOf<'curve'>,
  axis: 'vertical' | 'horizontal' = 'vertical',
  offset = 0,
): string | undefined {
  if (!curve.closed) return 'Revolve needs a closed construction curve.'
  const points = DrawnProfile.shape.points.safeParse(curve.points.map(({ u, v }) => [u, v]))
  if (!points.success) return points.error.issues[0]?.message ?? 'Invalid profile.'
  const coordinates = curve.points.map((p) => (axis === 'vertical' ? p.u : p.v))
  if (Math.min(...coordinates) < offset && Math.max(...coordinates) > offset)
    return 'The rotation axis crosses the profile. Move the axis to an edge or outside the outline.'
}

/** Start on the origin unless that would cut through the outline. */
export function defaultRevolveOffset(
  curve: NodeOf<'curve'>,
  axis: 'vertical' | 'horizontal',
): number {
  const coords = curve.points.map(({ u, v }) => (axis === 'vertical' ? u : v))
  const low = Math.min(...coords)
  const high = Math.max(...coords)
  return low < 0 && high > 0 ? (Math.abs(low) <= high ? low : high) : 0
}
