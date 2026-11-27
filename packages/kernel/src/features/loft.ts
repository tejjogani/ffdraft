import { type Shape3D, Shell, Solid } from 'replicad'
import { defineFeature, metalOf, solidFromBrep } from '../core'
import { curveWire } from '../geometry/section-wires'
import { isRuntimeFault, runtime } from '../runtime/index'
import { occtError, wrapShape } from '../solid/occt'

export const loft = defineFeature('loft', (node, ctx) => {
  if (node.sections.length < 2) throw new Error('Choose at least two different section curves.')
  const sections = node.sections.map((id) => curveWire(ctx.input(id), ctx.track))
  const closed = sections[0]!.closed
  if (sections.some((section) => section.closed !== closed))
    throw new Error('The section curves must all be open or all be closed.')
  const capped = node.capped && closed
  const { oc } = runtime()
  try {
    const builder = ctx.track(new oc.BRepOffsetAPI_ThruSections(capped, node.ruled, 1e-6))
    builder.SetMutableInput(false)
    builder.CheckCompatibility(true)
    for (const { wire } of sections) builder.AddWire(wire.wrapped)
    builder.Build()
    if (!builder.IsDone()) throw new Error('check the section order, spacing and shape')
    const shape = wrapShape<Shape3D>(builder.Shape())
    const solid = solidFromBrep(shape)
    if (!(capped ? shape instanceof Solid : shape instanceof Shell))
      throw new Error(
        capped ? 'the end sections could not be capped' : 'the sections form no sheet',
      )
    const check = ctx.track(new oc.BRepCheck_Analyzer(shape.wrapped, true))
    if (!check.IsValid()) throw new Error('check for crossed sections or overlapping curves')
    const body = { solid, ...metalOf(node) }
    return capped ? { bodies: [body] } : { sheets: [body] }
  } catch (error) {
    if (isRuntimeFault(error)) throw error
    throw occtError(error, 'Cannot loft these sections')
  }
})
