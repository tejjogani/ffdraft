import { z } from 'zod'

const coordinate = z.number().min(-1e7).max(1e7)
export const NurbsControlPoint = z.tuple([
  coordinate,
  coordinate,
  coordinate,
  z.number().positive().max(1e12),
])
export type NurbsControlPoint = z.infer<typeof NurbsControlPoint>
type XYZ = [number, number, number]

export const NurbsDefinition = z
  .object({
    degree: z.number().int().min(1).max(15).meta({ title: 'Curve degree' }),
    knots: z
      .array(z.number())
      .min(2)
      .max(4110)
      .meta({ title: 'Knots', description: 'Rhino knot vector, omitting the two exterior knots.' }),
    controlPoints: z.array(NurbsControlPoint).min(2).max(4096).meta({
      title: 'Control points',
      description:
        'Ordered [x, y, z, weight]. XYZ are Euclidean world coordinates in mm. Keep positive rational weights when reshaping the curve.',
    }),
  })
  .superRefine(({ degree, knots, controlPoints }, ctx) => {
    const count = controlPoints.length
    if (count <= degree || knots.length !== count + degree - 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['knots'],
        message:
          'A NURBS curve needs at least degree + 1 control points and point count + degree − 1 knots.',
      })
      return
    }
    let repeats = 0
    for (let i = 0; i < knots.length; i++) {
      if (i && knots[i]! < knots[i - 1]!) {
        ctx.addIssue({
          code: 'custom',
          path: ['knots'],
          message: 'Curve knots must be nondecreasing.',
        })
        return
      }
      repeats = i && knots[i] === knots[i - 1] ? repeats + 1 : 1
      if (repeats > degree) {
        ctx.addIssue({
          code: 'custom',
          path: ['knots'],
          message: 'A knot repeats more times than the degree.',
        })
        return
      }
    }
    if (knots[degree - 1]! >= knots[count - 1]!)
      ctx.addIssue({
        code: 'custom',
        path: ['knots'],
        message: 'A curve needs a nonempty parameter domain.',
      })
  })

type NurbsDefinition = z.infer<typeof NurbsDefinition>

/** Homogeneous de Boor evaluation using the Rhino knot convention (two exterior knots omitted). */
export function pointOnNurbs({ degree, knots, controlPoints }: NurbsDefinition, t: number): XYZ {
  let lo = degree,
    hi = controlPoints.length
  const parameter = Math.max(knots[degree - 1]!, Math.min(knots[hi - 1]!, t))
  while (hi - lo > 1) {
    const mid = Math.floor((hi + lo) / 2)
    if (parameter < knots[mid - 1]!) hi = mid
    else lo = mid
  }
  const poles = Array.from({ length: degree + 1 }, (_, j) => {
    const [x, y, z, w] = controlPoints[lo - degree + j]!
    return [x * w, y * w, z * w, w] as [number, number, number, number]
  })
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const index = lo - degree + j
      const a = knots[index - 1]!,
        b = knots[index + degree - r]!
      const alpha = b === a ? 0 : (parameter - a) / (b - a)
      const p = poles[j]!,
        prev = poles[j - 1]!
      for (let d = 0; d < 4; d++) p[d] = (1 - alpha) * prev[d]! + alpha * p[d]!
    }
  }
  const [x, y, z, w] = poles[degree]!
  return [x / w, y / w, z / w]
}

/** Display tessellation only. Degree, knots and rational poles are stored and exported exactly. */
export function sampleNurbs(curve: NurbsDefinition): XYZ[] {
  const { knots, degree, controlPoints } = curve
  const result = [pointOnNurbs(curve, knots[degree - 1]!)]
  const budgetPerSpan = Math.max(2, Math.floor(12000 / (controlPoints.length - degree)))
  const depthLimit = Math.min(10, Math.floor(Math.log2(budgetPerSpan)))
  const subdivide = (a: number, b: number, p: XYZ, q: XYZ, depth: number) => {
    if (degree > 1 && depth < depthLimit) {
      const mid = (a + b) / 2
      const m = pointOnNurbs(curve, mid)
      const deviates = (f: number, v: XYZ) =>
        Math.hypot(...v.map((value, d) => value - (p[d]! + (q[d]! - p[d]!) * f))) > 0.015
      if (
        deviates(0.5, m) ||
        deviates(0.25, pointOnNurbs(curve, (a + mid) / 2)) ||
        deviates(0.75, pointOnNurbs(curve, (mid + b) / 2))
      ) {
        subdivide(a, mid, p, m, depth + 1)
        subdivide(mid, b, m, q, depth + 1)
        return
      }
    }
    result.push(q)
  }
  for (let i = degree - 1; i < controlPoints.length - 1; i++) {
    const a = knots[i]!,
      b = knots[i + 1]!
    if (b > a) subdivide(a, b, result.at(-1)!, pointOnNurbs(curve, b), 0)
  }
  return result
}

/** Move duplicated seam poles together on a closed or periodic curve. */
export function withNurbsPoint(
  curve: NurbsDefinition,
  index: number,
  point: NurbsControlPoint,
): NurbsControlPoint[] {
  if (!Number.isInteger(index) || index < 0 || index >= curve.controlPoints.length)
    throw Error('Choose an existing control point.')
  const pts = curve.controlPoints
  const same = (a: NurbsControlPoint, b: NurbsControlPoint) => a.every((x, i) => x === b[i])
  let shared = 0
  for (let count = Math.min(curve.degree, Math.floor(pts.length / 2)); count > 0; count--) {
    if (pts.slice(0, count).every((p, i) => same(p, pts[pts.length - count + i]!))) {
      shared = count
      break
    }
  }
  const partner =
    index < shared
      ? pts.length - shared + index
      : index >= pts.length - shared
        ? index - (pts.length - shared)
        : -1
  return pts.map((p, i) => (i === index || i === partner ? point : p))
}
