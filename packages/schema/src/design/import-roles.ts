import { z } from 'zod'
import { GEM_CUT_IDS, GEM_MATERIAL_IDS, type GemCutId, type GemMaterialId } from '../domain/gems'
import { METAL_IDS, type MetalId } from '../domain/metals'
import { applyOps, type Design, MAX_DESIGN_CHANGE_OPS, newId, type Op, sameJson } from './design'
import { importRoleOf, type Node, type NodeOf } from './nodes'

type Mesh = NodeOf<'meshBody'>
type RhinoBody = Mesh & { source: Extract<Mesh['source'], { type: 'asset' }> }
type XYZ = readonly [number, number, number]
export interface ImportedRoleChoice {
  sourceId: string
  role: 'unassigned' | 'reference' | 'metal' | 'stone'
  material?: MetalId
  stone?: {
    species: GemMaterialId
    cut: GemCutId
    width: number
    length: number
    depth: number
    girdle: XYZ
    rotation: XYZ
  }
  head?: { sourceId: string; material: MetalId; style: 'prong' | 'basket' | 'bezel' } | null
}

const xyz = z.tuple([z.number(), z.number(), z.number()])
export const ImportedRoleChoiceSchema = z.object({
  sourceId: z.string().min(1),
  role: z.enum(['unassigned', 'reference', 'metal', 'stone']),
  material: z.enum(METAL_IDS).optional(),
  stone: z
    .object({
      cut: z.enum(GEM_CUT_IDS),
      species: z.enum(GEM_MATERIAL_IDS),
      width: z.number(),
      length: z.number(),
      depth: z.number(),
      girdle: xyz,
      rotation: xyz,
    })
    .optional(),
  head: z
    .object({
      sourceId: z.string().min(1),
      material: z.enum(METAL_IDS),
      style: z.enum(['prong', 'basket', 'bezel']),
    })
    .nullable()
    .optional(),
})

export function isRhinoRoleBody(node: Node | undefined): node is RhinoBody {
  return (
    node?.kind === 'meshBody' && node.source.type === 'asset' && importRoleOf(node) !== undefined
  )
}

export function rhinoRoleFrameIssue(node: Mesh): string | undefined {
  const t = node.transform
  if (
    !node.keepSourcePlacement ||
    node.meshEdits ||
    node.flatBack ||
    node.hollow ||
    node.smooth ||
    node.detail !== 1 ||
    (t && (t.scale !== 1 || t.position.some(Boolean) || t.rotation.some(Boolean)))
  )
    return 'The source mesh has been reshaped or moved. Use an original placed copy to measure its girdle and setting.'
}

export function rhinoRoleLinks(design: Design, sourceId: string) {
  const nodes = Object.values(design.nodes)
  let gem = nodes.find((n): n is NodeOf<'gem'> => n.kind === 'gem' && n.importSourceId === sourceId)
  const setting = nodes.find(
    (n): n is NodeOf<'setting'> =>
      n.kind === 'setting' &&
      (n.importSourceId === sourceId || (!!gem && !!n.importSourceId && n.gem === gem.id)),
  )
  if (!gem && setting && design.nodes[setting.gem]?.kind === 'gem')
    gem = design.nodes[setting.gem] as NodeOf<'gem'>
  return { gem, setting }
}

/** Same block member or source topology with the same displayed finish. A suggestion requires review. */
function matchKey(node: RhinoBody): string | undefined {
  const { rhinoContext: ctx, rhinoObjectId, rhinoLayer } = node.source
  const placed = ctx?.placements ?? []
  const member = placed.length ? rhinoObjectId : undefined
  if (!member && !(ctx?.archiveId && ctx.topology)) return
  return JSON.stringify([
    ctx?.archiveId,
    member ?? ctx?.topology,
    rhinoLayer,
    ctx?.material,
    placed.map((p) => [p.definitionId, p.layer, p.material]),
  ])
}

export function rhinoRoleCandidates(design: Design, sourceId: string): string[] {
  const seed = design.nodes[sourceId]
  if (!isRhinoRoleBody(seed)) return []
  const key = matchKey(seed)
  if (!key) return [sourceId]
  return design.order.filter((id) => {
    const n = design.nodes[id]
    return isRhinoRoleBody(n) && matchKey(n) === key
  })
}

function sourceBody(design: Design, id: string) {
  const node = design.nodes[id]
  if (!isRhinoRoleBody(node)) throw new Error('Choose a Rhino part from this project.')
  return node
}

function requireOriginal(node: Mesh) {
  const issue = rhinoRoleFrameIssue(node)
  if (issue) throw new Error(issue)
}

export function reviewRhinoRoles(design: Design, choices: readonly ImportedRoleChoice[]): Op[] {
  const ops: Op[] = []
  const claimed = new Set<string>()
  function claim(id: string) {
    if (claimed.has(id)) throw new Error('A physical part can appear only once in a role change.')
    claimed.add(id)
  }
  function update(node: Node, patch: Record<string, unknown>) {
    const fields = Object.entries(patch).filter(([k, v]) => !sameJson(Reflect.get(node, k), v))
    if (fields.length) ops.push({ t: 'update', id: node.id, patch: Object.fromEntries(fields) })
  }
  function detach(setting: NodeOf<'setting'>) {
    ops.push({ t: 'remove', id: setting.id })
    if (setting.importSourceId)
      update(sourceBody(design, setting.importSourceId), { importRole: 'unassigned' })
  }

  for (const choice of choices) {
    claim(choice.sourceId)
    const source = sourceBody(design, choice.sourceId)
    const { gem, setting } = rhinoRoleLinks(design, source.id)
    if (choice.role !== 'stone') {
      if (choice.role === 'metal' && !choice.material)
        throw new Error('Choose an alloy for casting metal.')
      if (gem?.importSourceId === source.id) {
        if (gem.sourcing)
          throw new Error('Remove the supplier fit before changing the role of this stone.')
        if (setting) detach(setting)
        ops.push({ t: 'remove', id: gem.id })
      } else if (setting?.importSourceId === source.id) ops.push({ t: 'remove', id: setting.id })
      update(source, {
        importRole: choice.role,
        ...(choice.role === 'metal' && { material: choice.material }),
      })
      continue
    }
    if (gem && gem.importSourceId !== source.id)
      throw new Error('Detach this source part from its current setting first.')
    const s = choice.stone
    if (!s) throw new Error('Confirm the cut, species, dimensions and girdle for this stone.')
    requireOriginal(source)
    if (
      ![s.width, s.length, s.depth, ...s.girdle, ...s.rotation].every(Number.isFinite) ||
      s.length < s.width ||
      s.width < 0.6 ||
      s.length > 40 ||
      s.depth < 0.1 ||
      s.depth > 40 ||
      s.length / s.width > 5
    )
      throw new Error(
        'Check the stone dimensions and placement. Length must be at least the width.',
      )
    const transform = {
      position: [...s.girdle] as [number, number, number],
      rotation: [...s.rotation] as [number, number, number],
      scale: 1,
    }
    const importSourceFit = {
      cut: s.cut,
      width: s.width,
      length: s.length,
      depth: s.depth,
      transform,
    }
    const gemFields = {
      cut: s.cut,
      stone: s.species,
      width: s.width,
      lw: s.length / s.width,
      transform,
      importSourceFit,
    }
    const gemId = gem?.id ?? newId('gem')
    update(source, { importRole: 'stone' })
    if (gem) {
      const baseline = gem.importSourceFit
      const sameSource = sameJson(baseline, importSourceFit) && gem.stone === s.species
      if (!sameSource) {
        const edited =
          gem.sourcing ||
          (baseline &&
            (gem.cut !== baseline.cut ||
              gem.width !== baseline.width ||
              gem.lw !== baseline.length / baseline.width ||
              !sameJson(gem.transform, baseline.transform)))
        if (edited)
          throw new Error(
            'Undo the later stone edits or supplier fit before changing its original measurements.',
          )
        update(gem, gemFields)
      }
    } else
      ops.push({
        t: 'add',
        node: {
          kind: 'gem',
          id: gemId,
          name: source.name,
          importSourceId: source.id,
          ...gemFields,
        },
      })
    const head = choice.head
    if (head === undefined) continue
    if (setting && setting.importSourceId !== head?.sourceId) detach(setting)
    if (!head) continue
    claim(head.sourceId)
    const metal = sourceBody(design, head.sourceId)
    requireOriginal(metal)
    const occupied = rhinoRoleLinks(design, metal.id)
    if (occupied.gem && occupied.gem.id !== gemId)
      throw new Error('This part is already assigned to another stone.')
    const headFields = { material: head.material, style: head.style }
    update(metal, { importRole: 'setting', material: head.material })
    if (setting?.importSourceId === metal.id) update(setting, headFields)
    else
      ops.push({
        t: 'add',
        node: {
          kind: 'setting',
          id: newId('setting'),
          name: metal.name,
          gem: gemId,
          importSourceId: metal.id,
          ...headFields,
        },
      })
  }
  if (ops.length > MAX_DESIGN_CHANGE_OPS)
    throw new Error('Review fewer parts together so this decision can be undone in one step.')
  // This also guards dependent custom features against an implicit cascade.
  if (ops.length) applyOps(design, ops)
  return ops
}
