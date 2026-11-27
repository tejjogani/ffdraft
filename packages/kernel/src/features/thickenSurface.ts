import { isSectionSurface } from '@pave/schema'
import { Solid } from 'replicad'
import { defineFeature, metalOf, runtime, solidFromBrep } from '../core'
import { isRuntimeFault } from '../runtime/index'
import { occtError, scoped, shapeVolume, wrapShape } from '../solid/occt'

export const thickenSurface = defineFeature('thickenSurface', (node, ctx) => {
  const source = ctx.input(node.surface)
  const sheet = source.sheets?.[0]?.solid.brep()
  if (!isSectionSurface(source.node) || source.sheets?.length !== 1 || !sheet)
    throw new Error('Choose an uncapped loft or rail sweep with one exact surface.')
  if (!(node.thickness >= 0.05 && node.thickness <= 20))
    throw new Error('Thickness must be between 0.05 and 20 mm.')
  const { oc } = runtime()
  const offset = node.reverse ? -node.thickness : node.thickness
  const reduce = 'Reduce the thickness or reverse the direction.'
  try {
    return scoped((own) => {
      const builder = own(new oc.BRepOffsetAPI_MakeThickSolid())
      builder.MakeThickSolidBySimple(sheet.wrapped, offset)
      if (!builder.IsDone()) throw new Error(reduce)
      const shape = wrapShape(builder.Shape())
      try {
        if (
          !(shape instanceof Solid) ||
          !oc.BRepLib.OrientClosedSolid(shape.wrapped) ||
          !own(new oc.BRepCheck_Analyzer(shape.wrapped, true)).IsValid() ||
          !(shapeVolume(shape) > 1e-9)
        )
          throw new Error(reduce)
        return {
          bodies: [{ solid: solidFromBrep(shape), ...metalOf(node) }],
          consumes: [node.surface],
        }
      } catch (error) {
        shape.delete()
        throw error
      }
    })
  } catch (error) {
    if (isRuntimeFault(error)) throw error
    throw occtError(error, 'Cannot thicken this surface')
  }
})
