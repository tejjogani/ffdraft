import { GEM_CUT_IDS, type GemCutId, type GemMaterialId } from '../domain/gems'
import { isRhinoRoleBody } from './import-roles'
import { importRoleOf, type Node } from './nodes'
import { sourceRenderAppearance } from './source-appearance'

export type DiaexCutId = Exclude<GemCutId, 'cabochon'>
export const DIAEX_CUT_IDS = GEM_CUT_IDS.filter((cut): cut is DiaexCutId => cut !== 'cabochon')
export const DIAEX_DIAMOND_MATERIALS: readonly GemMaterialId[] = [
  'diamond',
  'diamond-lab',
  'diamond-yellow',
  'diamond-pink',
]

/** A source appearance can identify a diamond for browsing before it has a production role. */
export function importedDiamondSpecies(node: Node | undefined): GemMaterialId | undefined {
  if (!isRhinoRoleBody(node) || !node.visible || importRoleOf(node) !== 'unassigned') return
  const { rhinoContext } = node.source
  const supplier = rhinoContext?.stullerMaterial
  const appearance = supplier
    ? sourceRenderAppearance({ groups: [], placements: [], stullerMaterial: supplier })
    : sourceRenderAppearance(rhinoContext)
  if (appearance?.kind === 'gem' && DIAEX_DIAMOND_MATERIALS.includes(appearance.stone))
    return appearance.stone
}

/** Infer a cut only when the source object's name contains one unambiguous cut token. */
export function importedDiamondCut(node: Node | undefined): DiaexCutId | undefined {
  if (!isRhinoRoleBody(node)) return
  const stored = node.source.rhinoObjectName
  // Older imports only retain the outliner label, sometimes prefixed with the block path.
  const label = node.name
  const legacyName =
    label && !/^Part \d+(?:$| \()/i.test(label) ? label.split(' / ').at(-1) : undefined
  const name = stored === undefined ? legacyName : stored
  const tokens = new Set(name?.toLowerCase().split(/[^\p{L}\p{N}]+/u))
  const cuts = GEM_CUT_IDS.filter((cut) => tokens.has(cut))
  return cuts.length === 1 && cuts[0] !== 'cabochon' ? cuts[0] : undefined
}
