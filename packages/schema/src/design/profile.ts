import { z } from 'zod'

export const PROFILE_PLANES = ['front', 'top', 'right'] as const
export const PROFILE_POINT_LIMIT = 128

const coordinate = z.number().min(-250).max(250)
export type ProfilePoint = [number, number]
const point = z.tuple([coordinate, coordinate])

const side = (a: ProfilePoint, b: ProfilePoint, c: ProfilePoint) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

function contains(a: ProfilePoint, b: ProfilePoint, p: ProfilePoint): boolean {
  return (
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1])
  )
}

function crosses(a: ProfilePoint, b: ProfilePoint, c: ProfilePoint, d: ProfilePoint): boolean {
  const abC = side(a, b, c)
  const abD = side(a, b, d)
  const cdA = side(c, d, a)
  const cdB = side(c, d, b)
  return (
    (abC * abD < 0 && cdA * cdB < 0) ||
    (abC === 0 && contains(a, b, c)) ||
    (abD === 0 && contains(a, b, d)) ||
    (cdA === 0 && contains(c, d, a)) ||
    (cdB === 0 && contains(c, d, b))
  )
}

/** Measured, closed profiles use distinct vertices. The closing edge is implicit. */
function outlineError(points: readonly ProfilePoint[]): string | null {
  if (new Set(points.map(([u, v]) => `${u},${v}`)).size !== points.length)
    return 'Each point must be in a different place.'
  let doubledArea = 0
  for (const [i, a] of points.entries()) {
    const b = points[(i + 1) % points.length]!
    doubledArea += a[0] * b[1] - a[1] * b[0]
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue
      if (crosses(a, b, points[j]!, points[(j + 1) % points.length]!))
        return 'The profile edges cross. Move a point to make one closed outline.'
    }
  }
  return Math.abs(doubledArea) <= 1e-6 ? 'The profile needs to enclose an area.' : null
}

export const DrawnProfile = z.object({
  type: z.literal('profile'),
  plane: z.enum(PROFILE_PLANES),
  mode: z.enum(['polyline', 'rectangle']).default('polyline'),
  points: z
    .array(point)
    .min(3, 'Add at least three points.')
    .max(PROFILE_POINT_LIMIT)
    .superRefine((points, ctx) => {
      const message = outlineError(points)
      if (message) ctx.addIssue({ code: 'custom', message })
    })
    .meta({
      title: 'Points in millimetres',
      description:
        'Ordered [horizontal, vertical] coordinates on the drawing plane; closes from the final point to the first.',
    }),
})
export type DrawnProfile = z.infer<typeof DrawnProfile>
export type ProfilePlane = DrawnProfile['plane']
