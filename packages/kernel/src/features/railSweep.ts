import { Solid as BrepSolid, type Shape3D, type Wire } from 'replicad'
import { defineFeature, metalOf, runtime, solidFromBrep } from '../core'
import { curveWire } from '../geometry/section-wires'
import { twoRailSweep } from '../geometry/two-rail-sweep'
import { isRuntimeFault } from '../runtime/index'
import { occtError, scoped, shapeVolume, wrapShape } from '../solid/occt'

function oneRail(rail: Wire, sections: Wire[], capped: boolean): Shape3D {
  const { oc } = runtime()
  return scoped((own) => {
    const builder = own(new oc.BRepOffsetAPI_MakePipeShell(rail.wrapped))
    builder.SetMode(false)
    builder.SetTransitionMode(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner)
    builder.SetTolerance(1e-5, 1e-5, 0.01)
    // Preserve the model-space section instead of translating or reorienting it onto the rail.
    for (const wire of sections) builder.Add(wire.wrapped, false, false)
    if (!builder.IsReady()) throw new Error('The sections could not be placed on the rail.')
    builder.Build()
    if (!builder.IsDone()) throw new Error('The rail could not carry these sections.')
    if (capped && !builder.MakeSolid()) throw new Error('The sweep could not be capped.')
    return wrapShape<Shape3D>(builder.Shape())
  })
}

export const railSweep = defineFeature('railSweep', (node, ctx) => {
  if (!(node.rails.length === 1 || node.rails.length === 2) || node.sections.length === 0)
    throw new Error('Select one or two rails and at least one section.')
  const withWire = (id: string) => {
    const source = ctx.input(id)
    return { source, ...curveWire(source, ctx.track) }
  }
  const rails = node.rails.map(withWire)
  const sections = node.sections.map(withWire)
  const closed = sections[0]!.closed
  if (sections.some((s) => s.closed !== closed))
    throw new Error('Sweep sections must be either all closed or all open.')
  if (node.capped && !closed) throw new Error('Close the sections or turn caps off.')
  let shape: Shape3D | undefined
  try {
    shape = rails[1]
      ? twoRailSweep([rails[0]!, rails[1]], sections, node.capped, ctx.track)
      : oneRail(
          rails[0]!.wire,
          sections.map((s) => s.wire),
          node.capped,
        )
    const { oc } = runtime()
    const valid = scoped((own) => own(new oc.BRepCheck_Analyzer(shape!.wrapped, true)).IsValid())
    if (!valid || (node.capped && !(shape instanceof BrepSolid && shapeVolume(shape) > 1e-9)))
      throw new Error(
        'The sweep produced invalid geometry. Check for crossing sections or sharp rail bends.',
      )
    const body = { solid: solidFromBrep(shape), ...metalOf(node) }
    return node.capped ? { bodies: [body] } : { sheets: [body] }
  } catch (error) {
    shape?.delete()
    if (isRuntimeFault(error)) throw error
    throw occtError(error, 'Cannot build rail sweep')
  }
})
