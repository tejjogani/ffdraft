import { type NodeOf, pointFromCurvePlane } from '@pave/schema'
import { assembleWire, type Edge, makeLine, type Wire } from 'replicad'
import type { BuildContext, NodeResult } from '../core'
import { isRuntimeFault, runtime } from '../runtime/index'
import { occtError, scoped, wrapShape } from '../solid/occt'
import { type Mat4, transformPoint } from './vec'

function nurbsEdge(node: NodeOf<'nurbsCurve'>, matrix: Mat4): Edge {
  const { oc } = runtime()
  const { knots, degree, controlPoints } = node
  // Rhino omits the two exterior knots. Their values do not affect the curve on its domain.
  const unique: number[] = []
  const counts: number[] = []
  for (const knot of [knots[0]!, ...knots, knots.at(-1)!]) {
    if (knot === unique.at(-1)) counts[counts.length - 1]!++
    else {
      unique.push(knot)
      counts.push(1)
    }
  }
  return scoped((own) => {
    const poles = own(new oc.NCollection_Array1_gp_Pnt(1, controlPoints.length))
    const weights = own(new oc.NCollection_Array1_double(1, controlPoints.length))
    const parameters = own(new oc.NCollection_Array1_double(1, unique.length))
    const multiplicities = own(new oc.NCollection_Array1_int(1, unique.length))
    controlPoints.forEach(([x, y, z, weight], i) => {
      const point = own(new oc.gp_Pnt(...transformPoint(matrix, [x, y, z])))
      poles.SetValue(i + 1, point)
      weights.SetValue(i + 1, weight)
    })
    unique.forEach((knot, i) => {
      parameters.SetValue(i + 1, knot)
      multiplicities.SetValue(i + 1, counts[i]!)
    })
    const curve = own(
      new oc.Geom_BSplineCurve(poles, weights, parameters, multiplicities, degree, false, true),
    )
    const builder = own(new oc.BRepBuilderAPI_MakeEdge(curve))
    return wrapShape<Edge>(builder.Edge())
  })
}

/** Converts a referenced curve to a wire in world millimetres, retaining its exact geometry. */
export function curveWire(
  { node, matrix }: Pick<NodeResult, 'node' | 'matrix'>,
  track: BuildContext['track'],
): { wire: Wire; closed: boolean } {
  const label = `Curve “${node.name ?? node.id}”`
  try {
    if (node.kind === 'curve') {
      const points = node.points.map(({ u, v }) =>
        transformPoint(matrix, pointFromCurvePlane(node.plane, [u, v])),
      )
      const edges = points
        .slice(0, node.closed ? points.length : -1)
        .map((point, i) => track(makeLine([...point], [...points[(i + 1) % points.length]!])))
      return { wire: track(assembleWire(edges)), closed: node.closed }
    }
    if (node.kind === 'nurbsCurve') {
      const wire = track(assembleWire([track(nurbsEdge(node, matrix))]))
      if (!(wire.length > 1e-7)) throw new Error('it has no usable length')
      return { wire, closed: runtime().oc.BRep_Tool.IsClosed(wire.wrapped) }
    }
    throw new Error('select a construction or NURBS curve')
  } catch (error) {
    if (isRuntimeFault(error)) throw error
    throw occtError(error, `${label} cannot supply a wire`)
  }
}
