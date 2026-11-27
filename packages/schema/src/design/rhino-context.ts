import { z } from 'zod'

const supplierText = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^\p{Cc}]+$/u)
export const RhinoStullerMaterial = z.union([
  z.object({ metal: supplierText }).strict(),
  z.object({ stoneFamily: supplierText, stoneColor: supplierText.optional() }).strict(),
])
export type RhinoStullerMaterial = z.infer<typeof RhinoStullerMaterial>

export const RhinoMaterialAppearance = z.strictObject({
  /** Diffuse color in sRGB, as stored in the source material. */
  color: z
    .string()
    .regex(/^#[\da-f]{6}$/i)
    .optional(),
  /** Source material opacity, where 1 is opaque. */
  opacity: z.number().min(0).max(1).optional(),
})
export type RhinoMaterialAppearance = z.infer<typeof RhinoMaterialAppearance>

const RhinoGroup = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
})

const RhinoPlacement = z.object({
  id: z.string().min(1),
  definitionId: z.string().min(1),
  layer: z.string().optional(),
  material: z.string().optional(),
  materialAppearance: RhinoMaterialAppearance.optional(),
  materialFromParent: z.literal(true).optional(),
})

export const RhinoContext = z.object({
  /** Local namespace shared only by parts from the same import. */
  archiveId: z.string().min(1).optional(),
  /** Source-file groups of the member and its containing placements. */
  groups: z.array(RhinoGroup),
  /** Occurrences from the outermost block towards the member. */
  placements: z.array(RhinoPlacement).max(32),
  /** Source geometry kind and native BRep face, edge and vertex counts. */
  topology: z.string().optional(),
  /** Object- or occurrence-specific supplier labels copied from the original file. */
  stullerMaterial: RhinoStullerMaterial.optional(),
  /** Name of the member's Rhino display material, independent of its Pavé alloy. */
  material: z.string().optional(),
  materialAppearance: RhinoMaterialAppearance.optional(),
  materialFromParent: z.literal(true).optional(),
})

/** Identities are shared within one import and namespaced across imports. */
export type RhinoContext = z.infer<typeof RhinoContext>

/** Inherited materials stop at the first placement with its own object or layer binding. */
export function inheritedMaterial(placements: readonly RhinoContext['placements'][number][]) {
  return placements.findLast((placement) => !placement.materialFromParent)?.material
}

export function inheritedMaterialAppearance(
  placements: readonly RhinoContext['placements'][number][],
) {
  return placements.findLast((placement) => !placement.materialFromParent)?.materialAppearance
}

/** Exact recovery may add missing metadata. Keep the project’s existing identities and bindings. */
export function recoverRhinoContext(
  current: RhinoContext | undefined,
  source: RhinoContext | undefined,
) {
  if (!current || !source) return source
  const stullerMaterial = !current.stullerMaterial ? source.stullerMaterial : undefined
  const matchesBinding = (
    a: Pick<RhinoContext, 'material' | 'materialFromParent'>,
    b: Pick<RhinoContext, 'material' | 'materialFromParent'>,
  ) => a.material === b.material && a.materialFromParent === b.materialFromParent
  const materialAppearance =
    !current.materialAppearance && matchesBinding(current, source)
      ? source.materialAppearance
      : undefined
  const matchPlacements =
    current.placements.length === source.placements.length &&
    current.placements.every((placement, i) => {
      const original = source.placements[i]!
      return placement.layer === original.layer && matchesBinding(placement, original)
    })
  const placements = matchPlacements
    ? current.placements.map((placement, i) => {
        const appearance = source.placements[i]?.materialAppearance
        return !placement.materialAppearance && appearance
          ? { ...placement, materialAppearance: appearance }
          : placement
      })
    : current.placements
  if (
    !stullerMaterial &&
    !materialAppearance &&
    placements.every((placement, i) => placement === current.placements[i])
  )
    return undefined
  return {
    ...current,
    placements,
    ...(stullerMaterial && { stullerMaterial }),
    ...(materialAppearance && { materialAppearance }),
  }
}
