/** Test support: every canon-built design (exemplars and templates), with its context. */
import {
  type Archetype,
  applyOps,
  type Design,
  designFrom,
  type Node,
  type Op,
  type PieceSpecInput,
  TEMPLATES,
} from '@pave/schema'
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
import { type Facts, nodeFacts, type PairWith, pieceFacts } from './facts'
import type { Rule } from './model'
import { suggestDesign } from './suggest'

export interface CorpusItem {
  id: string
  design: Design
  archetype: Archetype
  styles: readonly string[]
  pairWith?: PairWith
}

const us = (value: number) => ({ size: { system: 'us' as const, value } })
const spec = (s: Omit<PieceSpecInput, 'title' | 'summary'>): PieceSpecInput => ({
  title: 'fixture',
  summary: '',
  ...s,
})
/** A canon-built fixture, optionally with the edits that put it in a rule's reach. */
const fixture = (
  id: string,
  s: PieceSpecInput,
  ops: Op[] = [],
  pairWith?: PairWith,
): CorpusItem => ({
  id: `fixture:${id}`,
  design: applyOps(suggestDesign(s, pairWith ? { pairWith } : {}).design, ops).design,
  archetype: s.archetype,
  styles: s.style ?? [],
  ...(pairWith ? { pairWith } : {}),
})
const solitaire = (o: Partial<PieceSpecInput> = {}) =>
  spec({
    kind: 'ring',
    archetype: 'solitaire',
    ring: us(6),
    stones: [{ role: 'center', carat: 1 }],
    ...o,
  })
/** A circle of path points: a bangle of inner diameter `id` in wire `w`. */
const ring = (id: number, w: number): [number, number, number][] =>
  Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * 2 * Math.PI
    const r = (id + w) / 2
    return [r * Math.cos(a), 0, r * Math.sin(a)]
  })

/**
 * Fixtures for the rules no exemplar or template reaches, so every rule is evaluated somewhere:
 * east-west, flush-fit, split shanks, double and bare claws, pear sides, two-row pavé, wedding
 * pairs, engraving, sterling, an iced bail, martini studs and a bangle.
 */
const FIXTURES: readonly CorpusItem[] = [
  fixture(
    'east-west',
    solitaire({ style: ['east-west'], stones: [{ role: 'center', cut: 'oval', carat: 1 }] }),
  ),
  fixture('flush-fit', solitaire({ style: ['wedding set'] })),
  fixture('split', solitaire({ ring: { ...us(6), shoulder: 'split' } })),
  fixture('princess', solitaire({ stones: [{ role: 'center', cut: 'princess', carat: 1 }] })),
  fixture(
    'xl-iced',
    spec({
      kind: 'pendant',
      archetype: 'icedPendant',
      body: { heightMm: 100, text: 'K' },
      stones: [{ role: 'pave', widthMm: 2.0 }],
      chain: { style: 'cuban', lengthMm: 610, widthMm: 12 },
    }),
  ),
  fixture('double-tip', solitaire(), [{ t: 'update', id: 'head', patch: { prongTip: 'double' } }]),
  fixture('bare-claws', solitaire(), [{ t: 'update', id: 'head', patch: { style: 'prong' } }]),
  fixture(
    'pear-sides',
    spec({
      kind: 'ring',
      archetype: 'threeStone',
      ring: us(6),
      stones: [
        { role: 'center', cut: 'oval', carat: 1 },
        { role: 'side', cut: 'pear' },
      ],
    }),
  ),
  fixture(
    'two-rows',
    spec({
      kind: 'ring',
      archetype: 'band',
      ring: { ...us(6), bandWidthMm: 4.5 },
      stones: [{ role: 'accent', widthMm: 1.5, setting: 'pave' }],
    }),
    [{ t: 'update', id: 'row', patch: { rows: 2 } }],
  ),
  fixture(
    'wedding-pair',
    spec({ kind: 'ring', archetype: 'band', ring: us(6), engraving: 'Always' }),
    [],
    { widthMm: 2.0, thicknessMm: 1.7 },
  ),
  fixture(
    'outside-engraving',
    spec({ kind: 'ring', archetype: 'band', ring: us(6), engraving: 'AMOR' }),
    [{ t: 'update', id: 'engraving', patch: { where: 'outsideBand', size: 3 } }],
  ),
  fixture(
    'sterling-band',
    spec({ kind: 'ring', archetype: 'band', ring: us(8), metal: { alloy: 'ag925-sterling' } }),
  ),
  fixture(
    'iced-bail',
    spec({
      kind: 'pendant',
      archetype: 'icedPendant',
      body: { heightMm: 50, text: 'B' },
      chain: { style: 'cuban', lengthMm: 559, widthMm: 6 },
    }),
    [{ t: 'add', node: { id: 'bailIce', kind: 'pave', host: 'bail', sizeMax: 1.0, sizeMin: 1.0 } }],
  ),
  fixture(
    'martini-studs',
    spec({
      kind: 'earrings',
      archetype: 'studs',
      stones: [{ role: 'center', widthMm: 5.2, prongs: 3 }],
    }),
  ),
  {
    id: 'fixture:bangle',
    design: designFrom('bracelet', [
      {
        id: 'bangle',
        kind: 'pipe',
        material: 'au18k-yellow',
        points: ring(63.5, 3),
        closed: true,
        width: 3,
        thickness: 3,
      },
    ]),
    archetype: 'custom',
    styles: [],
  },
]

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
  ...FIXTURES,
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

/** A context where a rule applies and holds but its band does not evaluate. */
export interface Unevaluated {
  item: CorpusItem
  rule: Rule
  node?: Node
  facts: Facts
  undefinedBand: true
}

/** Every rule evaluated in every context of the corpus where it applies. */
export function evaluations(): Evaluation[] {
  return contexts().filter((e): e is Evaluation => !('undefinedBand' in e))
}

/** Every context of the corpus where a rule applies and holds, evaluated or not. */
export function contexts(): (Evaluation | Unevaluated)[] {
  const out: (Evaluation | Unevaluated)[] = []
  for (const item of CORPUS) {
    const ctx = { kind: item.design.kind, archetype: item.archetype, words: item.styles }
    const piece = pieceFacts(item.design, {
      styles: item.styles,
      ...(item.pairWith ? { pairWith: item.pairWith } : {}),
    })
    for (const rule of effectiveRules(matchStyles(item.styles))) {
      if (!ruleApplies(rule, ctx)) continue
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
        // A rule that applies and holds must evaluate: an undefined band is a rule that never
        // suggests or lints, which the rules test reports.
        if (!band || !hull) {
          out.push({ item, rule, node, facts, undefinedBand: true })
          continue
        }
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
