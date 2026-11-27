import { GEM_MATERIAL_IDS, GEM_MATERIALS, type GemMaterialId } from '../domain/gems'
import { METAL_IDS, METALS, type MetalId } from '../domain/metals'
import type { RhinoContext, RhinoMaterialAppearance } from './rhino-context'

/** Presentation only. An imported gemstone keeps its original mesh and production role. */
export type SourceRenderAppearance = RhinoMaterialAppearance &
  ({ kind: 'gem'; stone: GemMaterialId } | { kind: 'metal'; metal: MetalId } | { kind: 'surface' })

function binding(context: RhinoContext) {
  return context.materialFromParent
    ? context.placements.findLast((placement) => !placement.materialFromParent)
    : context
}

/** V-Ray appends a UUID to its asset names. Only remove that exact suffix for display. */
export function sourceMaterialLabel(context?: RhinoContext) {
  if (!context) return
  const name = binding(context)?.material
  return name?.replace(/^\/([^/]+)-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, '$1')
}

const normalize = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '')
const gems = new Map(
  GEM_MATERIAL_IDS.flatMap((id) => [
    [normalize(id), id] as const,
    [normalize(GEM_MATERIALS[id].label), id] as const,
  ]),
)
const metals = new Map<string, MetalId>([
  ['whitegold', 'au18k-white'],
  ['whitemetal', 'ag925-sterling'],
  ['yellowgold', 'au18k-yellow'],
  ['rosegold', 'au18k-rose'],
  ['platinum', 'pt950'],
  ['silver', 'ag925-sterling'],
  ['sterlingsilver', 'ag925-sterling'],
  ...METAL_IDS.flatMap((id) => [
    [normalize(id), id] as const,
    [normalize(METALS[id].label), id] as const,
  ]),
])

export function sourceRenderAppearance(context?: RhinoContext): SourceRenderAppearance | undefined {
  if (!context) return
  const raw = binding(context)?.materialAppearance
  const name = normalize(sourceMaterialLabel(context) ?? '')
  const supplier = context.stullerMaterial
  const family = supplier && 'stoneFamily' in supplier ? normalize(supplier.stoneFamily) : ''
  const color = supplier && 'stoneColor' in supplier ? normalize(supplier.stoneColor ?? '') : ''
  const gem = (color ? gems.get(family + color) : undefined) ?? gems.get(name) ?? gems.get(family)
  if (gem) return { ...raw, kind: 'gem', stone: gem }
  const metal = metals.get(name)
  if (metal) return { ...raw, kind: 'metal', metal }
  if (raw) return { ...raw, kind: 'surface' }
}
