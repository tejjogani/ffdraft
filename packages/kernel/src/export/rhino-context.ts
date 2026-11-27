import type { RhinoContext } from '@pave/schema'
import type {
  File3dm,
  File3dmGroupTable,
  File3dmMaterialTable,
  ObjectAttributes,
  RhinoModule,
} from 'rhino3dm'
import {
  inheritedMaterial,
  RHINO_INHERITED_MATERIAL,
  RHINO_PLACEMENT_CONTEXT,
  RHINO_SOURCE_GROUP_NAME,
} from '../import/rhino-context'
import { freeRhino } from '../runtime/rhino'

export function rhinoContextWriter(rhino: RhinoModule, doc: File3dm) {
  let groups: File3dmGroupTable | undefined
  let materials: File3dmMaterialTable | undefined
  const groupIndices = new Map<string, number>()
  const materialIndices = new Map<string, number>()
  const groupNames = new Set<string>()

  const groupIndex = (source: RhinoContext['groups'][number]): number => {
    const existing = groupIndices.get(source.id)
    if (existing !== undefined) return existing
    groups ??= doc.groups()
    const group = new rhino.Group()
    try {
      let name = source.name
      for (let suffix = 2; groupNames.has(name.toLowerCase()); suffix++) {
        name = `${source.name} (${suffix})`
      }
      group.name = name
      if (name !== source.name) group.setUserString(RHINO_SOURCE_GROUP_NAME, source.name)
      const index = groups.count
      groups.add(group)
      if (groups.count !== index + 1) throw new Error(`Rhino could not write group “${name}”.`)
      groupNames.add(name.toLowerCase())
      groupIndices.set(source.id, index)
      return index
    } finally {
      freeRhino(group)
    }
  }

  const materialIndex = (name: string | undefined): number | undefined => {
    if (!name) return undefined
    const existing = materialIndices.get(name)
    if (existing !== undefined) return existing
    materials ??= doc.materials()
    const material = new rhino.Material()
    try {
      material.name = name
      // The WASM binding returns the material index. Its definitions currently say void.
      const index = materials.add(material) as unknown as number
      if (index < 0) throw new Error(`Rhino could not write display material “${name}”.`)
      materialIndices.set(name, index)
      return index
    } finally {
      freeRhino(material)
    }
  }

  return {
    write(attrs: ObjectAttributes, context: RhinoContext) {
      for (const group of context.groups) attrs.addToGroup(groupIndex(group))
      const name = context.materialFromParent
        ? inheritedMaterial(context.placements)
        : context.material
      const index = materialIndex(name)
      if (index !== undefined) {
        attrs.materialSource = rhino.ObjectMaterialSource.MaterialFromObject
        attrs.materialIndex = index
      }
      // The exporter writes each evaluated placement independently. Keep the original
      // path on the geometry even when the block hierarchy is baked into world coordinates.
      attrs.setUserString(RHINO_PLACEMENT_CONTEXT, JSON.stringify(context.placements))
      if (context.materialFromParent) attrs.setUserString(RHINO_INHERITED_MATERIAL, '1')
    },

    materialIndex,

    dispose() {
      if (groups) freeRhino(groups)
      if (materials) freeRhino(materials)
    },
  }
}
