import { RhinoContext, type RhinoMaterialAppearance } from '@pave/schema'
import type { File3dm, Material, ObjectAttributes, RhinoModule } from 'rhino3dm'
import { freeRhino } from '../runtime/rhino'

export const RHINO_PLACEMENT_CONTEXT = 'paveRhinoPlacements'
export const RHINO_INHERITED_MATERIAL = 'paveRhinoInheritedMaterial'
export const RHINO_SOURCE_GROUP_NAME = 'paveRhinoGroupName'
export const RHINO_AUTHORED_DIFFUSE = 'paveRhinoAuthoredDiffuse'
export const RHINO_AUTHORED_OPACITY = 'paveRhinoAuthoredOpacity'

type SourceGroup = RhinoContext['groups'][number]
export type SourcePlacement = RhinoContext['placements'][number]
type SourceMaterial = Pick<RhinoContext, 'material' | 'materialAppearance' | 'materialFromParent'>

export { inheritedMaterial, inheritedMaterialAppearance } from '@pave/schema'

function diffuseRgb(material: Material): [number, number, number] {
  // The WASM property uses an RGBA object even though the declaration says number[].
  const { r, g, b } = material.diffuseColor as unknown as { r: number; g: number; b: number }
  return [r, g, b]
}

function appearanceOf(
  material: Material,
  defaultDiffuse: [number, number, number],
): RhinoMaterialAppearance | undefined {
  const channels = diffuseRgb(material)
  // Legacy named material placeholders were written with Rhino's default diffuse value.
  const authored =
    channels.some((channel, index) => channel !== defaultDiffuse[index]) ||
    material.getUserString(RHINO_AUTHORED_DIFFUSE) === '1'
  const color =
    authored &&
    channels.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)
      ? `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
      : undefined
  const transparency = material.transparency
  const authoredOpacity = material.getUserString(RHINO_AUTHORED_OPACITY) === '1'
  const opacity =
    (color || authoredOpacity || transparency > 0) && transparency >= 0 && transparency <= 1
      ? 1 - transparency
      : undefined
  return color || opacity !== undefined
    ? { ...(color && { color }), ...(opacity !== undefined && { opacity }) }
    : undefined
}

export function rhinoContextReader(rhino: RhinoModule, doc: File3dm) {
  const defaultMaterial = new rhino.Material()
  const defaultDiffuse = diffuseRgb(defaultMaterial)
  freeRhino(defaultMaterial)
  const groupTable = doc.groups()
  const materialTable = doc.materials()
  const groupByIndex = new Map<number, SourceGroup | null>()
  const materialByIndex = new Map<number, SourceMaterial>()
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

  const materialAt = (index: number | undefined): SourceMaterial => {
    if (index === undefined || index < 0) return {}
    if (!materialByIndex.has(index)) {
      const material = materialTable.findIndex(index) as ReturnType<
        typeof materialTable.findIndex
      > | null
      try {
        const name = material?.name?.trim()
        const appearance = material ? appearanceOf(material, defaultDiffuse) : undefined
        materialByIndex.set(index, {
          ...(name && { material: name }),
          ...(appearance && { materialAppearance: appearance }),
        })
      } finally {
        if (material) freeRhino(material)
      }
    }
    return materialByIndex.get(index)!
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
      return materialAt(
        source === rhino.ObjectMaterialSource.MaterialFromObject
          ? attrs?.materialIndex
          : source === rhino.ObjectMaterialSource.MaterialFromLayer
            ? layerMaterial
            : undefined,
      )
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
