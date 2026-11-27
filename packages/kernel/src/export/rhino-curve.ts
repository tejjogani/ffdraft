import type { NodeOf } from '@pave/schema'
import type { File3dmObjectTable, ObjectAttributes, RhinoModule } from 'rhino3dm'
import { freeRhino } from '../runtime/rhino'

/** Copy exact curve geometry into the export document. Viewport tessellation never reaches here. */
export function writeRhinoNurbsCurve(
  rhino: RhinoModule,
  table: File3dmObjectTable,
  node: NodeOf<'nurbsCurve'>,
  attrs: ObjectAttributes,
): void {
  const { degree, controlPoints, knots } = node
  const rational = controlPoints.some(([, , , w]) => w !== 1)
  const curve = new rhino.NurbsCurve(3, rational, degree + 1, controlPoints.length)
  try {
    const points = curve.points()
    const knotList = curve.knots()
    try {
      for (const [index, [x, y, z, w]] of controlPoints.entries())
        points.set(index, [x * w, y * w, z * w, w])
      for (const [index, knot] of knots.entries()) knotList.set(index, knot)
      if (!curve.isValid || table.addCurve(curve, attrs) === '00000000-0000-0000-0000-000000000000')
        throw new Error(`Rhino could not write curve “${node.name ?? node.id}”.`)
    } finally {
      freeRhino(knotList)
      freeRhino(points)
    }
  } finally {
    freeRhino(curve)
  }
}
