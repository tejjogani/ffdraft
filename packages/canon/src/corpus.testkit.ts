/** Test support: every canon-built design (exemplars and templates), with its context. */
import { type Archetype, type Design, type Node, TEMPLATES } from '@pave/schema'
import {
  bandFor,
  effectiveRules,
  hullFor,
  lintRange,
  matchStyles,
  ruleApplies,
  whenHolds,
} from './engine'
import { buildExemplar, EXEMPLAR_SOURCES } from './exemplars/index'
import { type Facts, nodeFacts, pieceFacts } from './facts'
import type { Rule } from './model'
import { suggestDesign } from './suggest'

export interface CorpusItem {
  id: string
  design: Design
  archetype: Archetype
  styles: readonly string[]
}

export const CORPUS: readonly CorpusItem[] = [
  ...EXEMPLAR_SOURCES.map((e) => ({
    id: e.id,
    design: buildExemplar(e),
    archetype: e.archetype,
    styles: e.styles,
  })),
  ...TEMPLATES.map((t) => ({
    id: `template:${t.id}`,
    design: suggestDesign(t.spec).design,
    archetype: t.spec.archetype,
    styles: t.spec.style ?? [],
  })),
]

export interface Evaluation {
  item: CorpusItem
  rule: Rule
  node?: Node
  facts: Facts
  band: { typical: number; min: number; max: number }
  hull: { typical: number; min: number; max: number }
  variants: { typical: number; min: number; max: number }[]
  lint?: { lo: number; hi: number }
}

/** Every rule evaluated in every context of the corpus where it applies. */
export function evaluations(): Evaluation[] {
  const out: Evaluation[] = []
  for (const item of CORPUS) {
    const ctx = { kind: item.design.kind, archetype: item.archetype, words: item.styles }
    const piece = pieceFacts(item.design, { styles: item.styles })
    for (const rule of effectiveRules(matchStyles(item.styles))) {
      if (rule.expressible === false || !ruleApplies(rule, ctx)) continue
      const nodes = rule.applies.nodeKind
        ? item.design.order
            .map((id) => item.design.nodes[id]!)
            .filter((n) => n.kind === rule.applies.nodeKind)
        : [undefined]
      for (const node of nodes) {
        const facts = node ? nodeFacts(item.design, node.id, piece) : piece
        if (!whenHolds(rule, facts)) continue
        const band = bandFor(rule, facts)
        const hull = hullFor(rule, facts)
        if (!band || !hull) continue
        const variants = Object.keys(rule.variants ?? {}).flatMap((v) => {
          const b = bandFor(rule, facts, v as 'delicate')
          return b ? [b] : []
        })
        const lint = lintRange(rule, facts)
        out.push({ item, rule, node, facts, band, hull, variants, ...(lint ? { lint } : {}) })
      }
    }
  }
  return out
}
