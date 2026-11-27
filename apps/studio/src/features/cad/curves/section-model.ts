import { type Design, type Node, type NodeOf, nodeTitle } from '@pave/schema'

export const SECTION_TOOLS = [
  { id: 'loft', kind: 'loft', title: 'Loft', minSections: 2, rails: 0 },
  { id: 'sweep1', kind: 'railSweep', title: 'Sweep 1 rail', minSections: 1, rails: 1 },
  { id: 'sweep2', kind: 'railSweep', title: 'Sweep 2 rails', minSections: 1, rails: 2 },
] as const

export type SectionTool = (typeof SECTION_TOOLS)[number]
export type SectionFeature = NodeOf<'loft'> | NodeOf<'railSweep'>

export type SectionDraft = {
  sections: string[]
  rails: string[]
  capped: boolean
  ruled: boolean
}

export const MAX_SECTIONS = 32

export const isSectionFeature = (node?: Node): node is SectionFeature =>
  node?.kind === 'loft' || node?.kind === 'railSweep'

export const sectionToolFor = (node: SectionFeature): SectionTool =>
  node.kind === 'loft'
    ? SECTION_TOOLS[0]
    : node.rails.length === 1
      ? SECTION_TOOLS[1]
      : SECTION_TOOLS[2]

function isSourceCurve(node?: Node): node is NodeOf<'curve'> | NodeOf<'nurbsCurve'> {
  return node?.kind === 'curve' || node?.kind === 'nurbsCurve'
}

export function sectionCurveOptions(design: Design) {
  const curves = design.order.map((id) => design.nodes[id]).filter(isSourceCurve)
  const labels = curves.map(nodeTitle)
  const counts = new Map<string, number>()
  for (const title of labels) counts.set(title, (counts.get(title) ?? 0) + 1)
  return curves.map((curve, index) => ({
    value: curve.id,
    label: counts.get(labels[index]!) === 1 ? labels[index]! : `${labels[index]} · ${index + 1}`,
    hint: curve.kind === 'curve' ? curve.plane : undefined,
  }))
}

export function initialSectionDraft(
  design: Design,
  tool: SectionTool,
  selection: readonly string[],
  node?: SectionFeature,
): SectionDraft {
  if (node)
    return {
      sections: [...node.sections],
      rails: node.kind === 'railSweep' ? [...node.rails] : [],
      capped: node.capped,
      ruled: node.kind === 'loft' && node.ruled,
    }
  const selected =
    tool.id === 'loft'
      ? [...new Set(selection)]
          .filter((id) => isSourceCurve(design.nodes[id]))
          .slice(0, MAX_SECTIONS)
      : []
  return {
    sections: [
      ...selected,
      ...Array<string>(Math.max(0, tool.minSections - selected.length)).fill(''),
    ],
    rails: Array<string>(tool.rails).fill(''),
    capped: true,
    ruled: false,
  }
}

export function sectionDraftProblem(design: Design, tool: SectionTool, draft: SectionDraft) {
  const { rails, sections } = draft
  if (sections.length < tool.minSections || sections.length > MAX_SECTIONS)
    return `Choose ${tool.minSections}–${MAX_SECTIONS} sections.`
  if (rails.length !== tool.rails) return `Choose ${tool.rails} rails.`
  const missingSection = sections.findIndex((id) => !isSourceCurve(design.nodes[id]))
  if (missingSection >= 0) return `Choose a curve for Section ${missingSection + 1}.`
  const missingRail = rails.findIndex((id) => !isSourceCurve(design.nodes[id]))
  if (missingRail >= 0) return `Choose a curve for Rail ${missingRail + 1}.`
  if (new Set([...sections, ...rails]).size !== sections.length + rails.length)
    return 'Choose a different curve for each section and rail.'
  if (draft.capped) {
    const openSection = sections.findIndex((id) => {
      const curve = design.nodes[id]
      return curve?.kind === 'curve' && !curve.closed
    })
    if (openSection >= 0)
      return `Close Section ${openSection + 1} or choose Surface for the output.`
  }
}
