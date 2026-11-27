import { RhinoContext } from '@pave/schema'
import type { File3dm, ObjectAttributes, RhinoModule } from 'rhino3dm'
import { freeRhino } from '../runtime/rhino'

export const RHINO_PLACEMENT_CONTEXT = 'paveRhinoPlacements'
export const RHINO_INHERITED_MATERIAL = 'paveRhinoInheritedMaterial'
export const RHINO_SOURCE_GROUP_NAME = 'paveRhinoGroupName'

type SourceGroup = RhinoContext['groups'][number]
export type SourcePlacement = RhinoContext['placements'][number]
type SourceMaterial = Pick<RhinoContext, 'material' | 'materialFromParent'>

export function inheritedMaterial(placements: readonly SourcePlacement[]): string | undefined {
  return placements.findLast((placement) => !placement.materialFromParent)?.material
}

export function rhinoContextReader(rhino: RhinoModule, doc: File3dm) {
  const groupTable = doc.groups()
  const materialTable = doc.materials()
  const groupByIndex = new Map<number, SourceGroup | null>()
  const materialByIndex = new Map<number, string | undefined>()
  const ids = new Map<string, string>()
  // Keep the source identities meaningful within a file and distinct when it is imported twice.
  const scope = crypto.randomUUID()
  const scopedId = (identity: string): string => {
    let id = ids.get(identity)
    if (!id) {
      id = `${scope}:${ids.size + 1}`
      ids.set(identity, id)
    }
    return id
  }

  const materialName = (index: number | undefined) => {
    if (index === undefined || index < 0) return undefined
    if (!materialByIndex.has(index)) {
      const material = materialTable.findIndex(index) as ReturnType<
        typeof materialTable.findIndex
      > | null
      try {
        materialByIndex.set(index, material?.name?.trim() || undefined)
      } finally {
        if (material) freeRhino(material)
      }
    }
    return materialByIndex.get(index)
  }

  return {
    archiveId: scope,
    groups(attrs: ObjectAttributes | undefined, parent: SourceGroup[] = []): SourceGroup[] {
      const indices = attrs?.getGroupList() ?? []
      if (!indices.length) return parent
      const combined = new Map(parent.map((group) => [group.id, group]))
      for (const index of indices) {
        if (!groupByIndex.has(index)) {
          const group = groupTable.findIndex(index) as ReturnType<
            typeof groupTable.findIndex
          > | null
          try {
            const name =
              group?.getUserString(RHINO_SOURCE_GROUP_NAME)?.trim() || group?.name?.trim()
            groupByIndex.set(
              index,
              group ? { id: scopedId(`group:${index}`), name: name || `Group ${index + 1}` } : null,
            )
          } finally {
            if (group) freeRhino(group)
          }
        }
        const group = groupByIndex.get(index)
        if (group) combined.set(group.id, group)
      }
      return [...combined.values()]
    },

    material(
      attrs: ObjectAttributes | undefined,
      layerMaterial: number | undefined,
    ): SourceMaterial {
      const source = attrs?.materialSource
      if (source === rhino.ObjectMaterialSource.MaterialFromParent)
        return { materialFromParent: true }
      const name = materialName(
        source === rhino.ObjectMaterialSource.MaterialFromObject
          ? attrs?.materialIndex
          : source === rhino.ObjectMaterialSource.MaterialFromLayer
            ? layerMaterial
            : undefined,
      )
      return name ? { material: name } : {}
    },

    placement(
      objectId: string,
      definitionId: string,
      layer: string | null,
      material: SourceMaterial,
      parent: SourcePlacement[],
    ): SourcePlacement[] {
      return [
        ...parent,
        {
          id: scopedId(`instance:${parent.at(-1)?.id ?? ''}/${objectId}`),
          definitionId: scopedId(`definition:${definitionId}`),
          ...(layer && { layer }),
          ...material,
        },
      ]
    },

    /** Pavé may bake block geometry into world space while carrying the source occurrence path. */
    savedPlacements(
      attrs: ObjectAttributes | undefined,
      parent: SourcePlacement[],
    ): SourcePlacement[] | undefined {
      const json = attrs?.getUserString(RHINO_PLACEMENT_CONTEXT)
      if (!json) return undefined
      try {
        const parsed = RhinoContext.shape.placements.safeParse(JSON.parse(json))
        if (!parsed.success || parsed.data.length + parent.length > 32) return undefined
        return [
          ...parent,
          ...parsed.data.map((placement) => ({
            ...placement,
            id: scopedId(`saved-instance:${parent.at(-1)?.id ?? ''}/${placement.id}`),
            definitionId: scopedId(`saved-definition:${placement.definitionId}`),
          })),
        ]
      } catch {
        return undefined
      }
    },

    dispose() {
      freeRhino(materialTable)
      freeRhino(groupTable)
    },
  }
}
