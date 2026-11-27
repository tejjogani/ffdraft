/**
 * The add menu's content and the "next step" chips: which kinds can be added now (the kernel
 * must support them; references must be satisfiable) and the few additions that most often
 * come next for the piece as it stands. Labels come from the schema (`describeNode`).
 */
import {
  type Design,
  defaultNode,
  describeNode,
  NODE_KINDS,
  type NodeKind,
  nodeRefs,
} from '@pave/schema'
import { SECTION_TOOLS, type SectionTool, sectionCurveOptions } from '../curves/section-model'

export interface AddOption {
  kind: NodeKind
  title: string
  description?: string
  /** Why it cannot be added yet ("Needs a Ring band"), or null. */
  disabled: string | null
  sectionTool?: SectionTool
}

export interface AddGroup {
  label: string
  options: AddOption[]
}

/** How the menu is organised; any kind not listed lands under "More". */
const GROUPS: { label: string; kinds: NodeKind[] }[] = [
  { label: 'Stones', kinds: ['gem', 'setting', 'halo', 'gemRow', 'pave'] },
  {
    label: 'Bodies',
    kinds: [
      'ringShank',
      'vectorBody',
      'meshBody',
      'relief',
      'revolve',
      'loft',
      'railSweep',
      'thickenSurface',
      'pipe',
      'primitive',
    ],
  },
  { label: 'Attach', kinds: ['bail', 'chain', 'finding', 'engraving'] },
  { label: 'Arrange', kinds: ['pattern', 'boolean', 'group'] },
]

function option(design: Design, kind: NodeKind, target?: string): AddOption {
  const d = describeNode(kind)
  const { missing } = defaultNode(kind, design, { target })
  const needs = missing
    .map((m) =>
      m.refKinds
        ? m.refKinds
            .map((k) => describeNode(k as NodeKind).title)
            .slice(0, 2)
            .join(' or ')
        : m.title,
    )
    .join(', ')
  return {
    kind,
    title: d.title,
    ...(d.description ? { description: d.description } : {}),
    disabled: missing.length ? `Needs a ${needs.toLowerCase()}` : null,
  }
}

export function addMenu(design: Design, kinds: readonly string[], target?: string): AddGroup[] {
  const supported = NODE_KINDS.filter((k) => k !== 'curve' && kinds.includes(k))
  const listed = new Set(GROUPS.flatMap((g) => g.kinds))
  const groups = [...GROUPS, { label: 'More', kinds: supported.filter((k) => !listed.has(k)) }]
  const curveCount = sectionCurveOptions(design).length
  return groups
    .map((g) => ({
      label: g.label,
      options: g.kinds
        .filter((k) => supported.includes(k))
        .flatMap((k): AddOption[] => {
          const tools = SECTION_TOOLS.filter((tool) => tool.kind === k)
          if (!tools.length) return [option(design, k, target)]
          return tools.map((tool) => ({
            kind: k,
            title: tool.title,
            sectionTool: tool,
            disabled:
              curveCount < tool.minSections + tool.rails
                ? `Needs at least ${tool.minSections + tool.rails} curves`
                : null,
          }))
        }),
    }))
    .filter((g) => g.options.length > 0)
}

export interface NextStep {
  label: string
  kind: NodeKind
  /** The node the new one attaches to. */
  target?: string
  /** What the new feature is called, after what the step was for ("Band pavé"). */
  name?: string
}

const BODY_FOR_ICE: ReadonlySet<NodeKind> = new Set(['vectorBody', 'meshBody', 'relief'])

/** At most three chips: what usually comes next for the design as it stands. */
export function nextSteps(design: Design, kinds: readonly string[]): NextStep[] {
  const nodes = design.order.map((id) => design.nodes[id]!)
  const referencing = (id: string, kind: NodeKind) =>
    nodes.some((n) => n.kind === kind && nodeRefs(n).includes(id))
  const out: NextStep[] = []
  const band = nodes.find((n) => n.kind === 'ringShank')
  if (band && !nodes.some((n) => n.kind === 'gem'))
    out.push({ label: 'Add a stone', kind: 'gem', target: band.id })
  const unset = nodes.find(
    (n) => n.kind === 'gem' && !referencing(n.id, 'setting') && !referencing(n.id, 'halo'),
  )
  if (unset) out.push({ label: 'Set the stone', kind: 'setting', target: unset.id })
  const body = nodes.find((n) => BODY_FOR_ICE.has(n.kind))
  if (body && !referencing(body.id, 'pave'))
    out.push({ label: 'Ice it out', kind: 'pave', target: body.id, name: 'Ice' })
  const bail = nodes.find((n) => n.kind === 'bail')
  if (body && !bail && design.kind === 'pendant')
    out.push({ label: 'Add a bail', kind: 'bail', target: body.id })
  if (bail && !nodes.some((n) => n.kind === 'chain'))
    out.push({ label: 'Hang on a chain', kind: 'chain', target: bail.id })
  if (band && nodes.some((n) => n.kind === 'gem') && !nodes.some((n) => n.kind === 'gemRow'))
    out.push({ label: 'Pavé the band', kind: 'gemRow', target: band.id, name: 'Band pavé' })
  return out
    .filter(
      (s) =>
        kinds.includes(s.kind) && !defaultNode(s.kind, design, { target: s.target }).missing.length,
    )
    .slice(0, 3)
}
