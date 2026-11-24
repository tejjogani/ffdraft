/**
 * canonFor: the focused slice of the canon for one piece. It builds a reference design for the
 * query with the canon's own suggestions, so every band prints as numbers for this stone, finger
 * and height, then ranks rules and picks exemplars by relevance and diversity (MMR, λ = 0.7).
 */
import {
  type Archetype,
  buildDesign,
  type Design,
  GEM_CUTS,
  type GemCutId,
  type GemMaterialId,
  type Node,
  type PieceKind,
  type PieceSpecInput,
  type RingSize,
} from '@pave/schema'
import { bandFor, effectiveRules, matchStyles, ruleApplies, specificity, whenHolds } from './engine'
import { getExemplars } from './exemplars/index'
import { evalExpr } from './expr'
import { nodeFacts, pieceFacts } from './facts'
import { MEASURES } from './measures'
import type { CanonSlice, Exemplar, ExemplarCard, Rule, SliceRule, Variant } from './model'
import { renderCanonForPrompt } from './prompt'
import { FAILURE_MODES } from './rubric'
import { suggestDesign } from './suggest'
import { CANON_VERSION, hash } from './version'

export interface CanonQuery {
  kind?: PieceKind
  archetype?: Archetype
  styles?: string[]
  centre?: { cut: GemCutId; widthMm: number; stone?: GemMaterialId }
  ringSize?: RingSize
  heightMm?: number
  variant?: Variant
  /** Size budget for the rendered pack, in estimated tokens (chars / 4). */
  budgetTokens?: number
  /** Exemplar cards, 2–4. */
  exemplars?: number
}

const KIND_OF: Record<Archetype, PieceKind> = {
  solitaire: 'ring',
  halo: 'ring',
  threeStone: 'ring',
  eternity: 'ring',
  band: 'ring',
  signet: 'ring',
  pendantSolitaire: 'pendant',
  namePendant: 'pendant',
  icedPendant: 'pendant',
  medallion: 'pendant',
  studs: 'earrings',
  tennis: 'bracelet',
  cuban: 'chain',
  custom: 'other',
}
const ARCHETYPE_OF: Partial<Record<PieceKind, Archetype>> = {
  ring: 'solitaire',
  pendant: 'pendantSolitaire',
  earrings: 'studs',
  bracelet: 'tennis',
  necklace: 'tennis',
  chain: 'cuban',
}

/** Questions that change geometry or cost (research 09 §6 "Briefing"), by archetype. */
const QUESTIONS: Record<Archetype, readonly string[]> = {
  solitaire: [
    'Ring size?',
    'Centre stone: shape, size or carat, natural or lab?',
    'Metal, and active hands or a flush-fit wedding band beside it?',
  ],
  halo: [
    'Ring size?',
    'Centre stone: shape, size or carat, natural or lab?',
    'Metal, and pavé on the band or plain?',
  ],
  threeStone: ['Ring size?', 'Centre and side stones: shapes and sizes?', 'Metal?'],
  eternity: [
    'Ring size (a full eternity cannot be resized)?',
    'Stone size and setting: pavé, channel or shared claws?',
    'Full, three-quarter or half?',
  ],
  band: [
    'Ring size?',
    'Width and profile?',
    'Metal and finish, and does it sit beside an engagement ring?',
  ],
  signet: [
    'Face size and what goes on it: crest, monogram or seal?',
    'Ring size and finger?',
    'Metal?',
  ],
  pendantSolitaire: ['Stone and size?', 'Metal and chain length?'],
  namePendant: ['The exact text and lettering?', 'Height and metal?', 'Chain length?'],
  icedPendant: [
    'Artwork and height?',
    'Ice level and stone tier: natural, lab or moissanite?',
    'Chain style, width and length?',
  ],
  medallion: ['Artwork for the relief, and the right to use it?', 'Diameter and metal?', 'Chain?'],
  studs: ['Stone size per ear (retail carats are pair totals)?', 'Metal and back?'],
  tennis: ['Wrist or neck measurement?', 'Stone size and quality?', 'Metal?'],
  cuban: ['Width, length and metal?', 'Clasp?'],
  custom: ['References or a sketch?', 'Size and metal?', 'Who wears it, and how often?'],
}

const SEVERITY = { warning: 3, info: 2, default: 1 } as const
const CONFIDENCE = { high: 3, medium: 2, low: 1 } as const
/** Warnings first, then the most specific; piece-wide checks (unity, simulants) last. */
const rank = (r: Rule) =>
  SEVERITY[r.severity] * 100 +
  specificity(r) * 15 +
  CONFIDENCE[r.confidence] * 5 -
  (r.applies.nodeKind ? 0 : 60)

function referenceDesign(
  q: CanonQuery,
  kind: PieceKind,
  archetype: Archetype,
  styles: string[],
): Design {
  const spec: PieceSpecInput = {
    kind,
    archetype,
    title: 'Canon query',
    summary: '',
    style: styles,
    ...(kind === 'ring' ? { ring: { size: q.ringSize ?? { system: 'us', value: 6 } } } : {}),
    stones: q.centre
      ? [
          {
            role: 'center',
            cut: q.centre.cut,
            widthMm: q.centre.widthMm,
            stone: q.centre.stone ?? 'diamond',
          },
        ]
      : [],
    // An iced query is read on the commonest iced form, a block initial.
    ...(q.heightMm || archetype === 'icedPendant'
      ? {
          body: {
            heightMm: q.heightMm ?? 50,
            ...(archetype === 'icedPendant' ? { text: 'A' } : {}),
          },
        }
      : {}),
    // Pendants are judged on a chain: a Cuban at 12 % of an iced piece, fine cable otherwise.
    ...(kind === 'pendant'
      ? {
          chain:
            archetype === 'icedPendant'
              ? {
                  style: 'cuban' as const,
                  lengthMm: 559,
                  widthMm: Math.max(3, Math.round(0.12 * (q.heightMm ?? 50))),
                }
              : { style: 'cable' as const, lengthMm: 457, widthMm: 1.2 },
        }
      : {}),
  }
  try {
    return suggestDesign(spec, q.variant ? { variant: q.variant } : {}).design
  } catch {
    return buildDesign(spec)
  }
}

/** Similarity of two exemplars for diversity: archetype, variant and shared style words. */
function similarity(a: Exemplar, b: Exemplar): number {
  const sa = new Set(matchStyles(a.styles).map((g) => g.id))
  const sb = new Set(matchStyles(b.styles).map((g) => g.id))
  const union = new Set([...sa, ...sb]).size
  const shared = [...sa].filter((x) => sb.has(x)).length
  return (
    (a.archetype === b.archetype ? 0.5 : 0) +
    (a.variant === b.variant ? 0.2 : 0) +
    (union ? (0.3 * shared) / union : 0)
  )
}

function pickExemplars(
  q: CanonQuery,
  kind: PieceKind,
  archetype: Archetype,
  count: number,
): Exemplar[] {
  const want = new Set(matchStyles(q.styles ?? []).map((g) => g.id))
  const cutFamily = q.centre && GEM_CUTS[q.centre.cut]
  const scored = getExemplars().map((e) => {
    const styleHits = matchStyles(e.styles).filter((g) => want.has(g.id)).length
    const cut = e.read.centre && GEM_CUTS[e.read.centre.cut]
    const size = q.centre?.widthMm ?? q.heightMm
    const key = q.centre ? e.sizeKey.W : e.sizeKey.H
    const score =
      (e.archetype === archetype ? 4 : 0) +
      (e.kind === kind ? 1 : 0) +
      2 * styleHits +
      (cut && cutFamily && cut.style === cutFamily.style && cut.outline === cutFamily.outline
        ? 1
        : 0) +
      (size && key && Math.abs(key - size) <= 0.25 * size ? 1 : 0) +
      (q.variant && e.variant === q.variant ? 1 : 0)
    return { e, score }
  })
  const top = Math.max(1, ...scored.map((s) => s.score))
  const chosen: Exemplar[] = []
  while (chosen.length < count) {
    let best: { e: Exemplar; v: number } | undefined
    for (const { e, score } of scored) {
      if (chosen.includes(e)) continue
      const sim = chosen.length ? Math.max(...chosen.map((c) => similarity(c, e))) : 0
      const v = 0.7 * (score / top) - 0.3 * sim
      if (!best || v > best.v + 1e-12) best = { e, v }
    }
    if (!best) break
    chosen.push(best.e)
  }
  return chosen
}

const card = (e: Exemplar): ExemplarCard => ({
  id: e.id,
  title: e.title,
  archetype: e.archetype,
  variant: e.variant,
  styles: e.styles,
  keyParams: e.keyParams,
  why: e.why,
  antiTwin: e.antiTwin.fault,
})

/** The focused canon for a query: ranked rules with evaluated bands, style guides, exemplars. */
export function canonFor(q: CanonQuery): CanonSlice {
  const archetype = q.archetype ?? (q.kind && ARCHETYPE_OF[q.kind]) ?? 'custom'
  const kind = q.kind ?? KIND_OF[archetype]
  const words = q.styles ?? []
  const styles = matchStyles(words)
  const design = referenceDesign(q, kind, archetype, words)
  const piece = pieceFacts(design, { styles: words })
  const ctx = { kind, archetype, words }
  const nodes = design.order.map((id) => design.nodes[id]).filter((n): n is Node => !!n)

  const caveats = new Map<string, string>()
  const ranked: { s: SliceRule; rank: number }[] = []
  for (const rule of effectiveRules(styles)) {
    if (!ruleApplies(rule, ctx)) continue
    // The first node the rule holds for (a side stone, not the centre, for side-stone rules).
    const candidates = rule.applies.nodeKind
      ? nodes.filter((n) => n.kind === rule.applies.nodeKind)
      : [undefined]
    const subject = candidates.find((n) =>
      whenHolds(rule, n ? nodeFacts(design, n.id, piece) : piece),
    )
    if (subject === undefined && (rule.applies.nodeKind || !whenHolds(rule, piece))) continue
    if (rule.expressible === false) {
      caveats.set(rule.title, rule.rationale)
      continue
    }
    const facts = subject ? nodeFacts(design, subject.id, piece) : piece
    // Checks with nothing to measure here, or that only guard against something absent, are noise.
    if (rule.measure) {
      const m = MEASURES[rule.measure]?.({ design, facts, node: subject })
      const zero = evalExpr(rule.band.max, facts) === 0
      if (!m || (zero && m.value === 0)) continue
    }
    const band = bandFor(rule, facts, q.variant)
    ranked.push({ s: band ? { rule, band } : { rule }, rank: rank(rule) })
  }
  const known = new Set([...caveats.keys()].map((k) => k.toLowerCase()))
  for (const g of styles)
    for (const c of g.cannotExpress)
      if (!known.has(c.feature.toLowerCase())) caveats.set(c.feature, c.fallback)
  ranked.sort((a, b) => b.rank - a.rank)

  const exemplars = pickExemplars(
    q,
    kind,
    archetype,
    Math.min(4, Math.max(2, q.exemplars ?? 3)),
  ).map(card)
  const base = {
    version: CANON_VERSION,
    styles,
    exemplars,
    caveats: [...caveats].slice(0, 6).map(([feature, fallback]) => ({ feature, fallback })),
    failureModes: FAILURE_MODES.filter((f) => f.archetypes.includes(archetype))
      .slice(0, 5)
      .map((f) => f.text),
    questions: QUESTIONS[archetype]
      .filter(
        (x) =>
          !(q.ringSize && x.startsWith('Ring size')) && !(q.centre && x.startsWith('Centre stone')),
      )
      .slice(0, 3),
  }
  const budget = q.budgetTokens ?? 1500
  let rules = ranked.map((r) => r.s)
  const slice = (): CanonSlice => {
    const content = { ...base, rules }
    const key = hash(
      JSON.stringify({
        kind,
        archetype,
        styles: styles.map((g) => g.id),
        exemplars: exemplars.map((e) => e.id),
        rules: rules.map((r) => [r.rule.id, r.band]),
      }),
    )
    return { ...content, key: `${kind}/${archetype}/${key}` }
  }
  let s = slice()
  while (rules.length > 6 && renderCanonForPrompt(s).length / 4 > budget) {
    rules = rules.slice(0, -1)
    s = slice()
  }
  return s
}
