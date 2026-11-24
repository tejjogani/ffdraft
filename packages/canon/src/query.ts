/**
 * canonFor: the focused slice of the canon for one piece. It builds a reference design for the
 * query (from its spec or design when given) with the canon's own suggestions, so every band
 * prints as numbers for this stone, finger and height, then ranks rules and picks exemplars by
 * relevance first and diversity second (MMR, λ = 0.7), inside a token budget.
 */
import {
  type Archetype,
  applyOps,
  buildDesign,
  type Design,
  GEM_CUTS,
  type GemCutId,
  type GemMaterialId,
  type Node,
  type NodeOf,
  type PieceKind,
  type PieceSpecInput,
  PieceSpecSchema,
  type RingSize,
} from '@pave/schema'
import { CAVEATS } from './caveats'
import { bandFor, effectiveRules, matchStyles, ruleApplies, specificity, whenHolds } from './engine'
import { getExemplars } from './exemplars/index'
import { evalExpr } from './expr'
import { nodeFacts, pieceFacts } from './facts'
import { MEASURES } from './measures'
import type { CanonSlice, Caveat, Exemplar, ExemplarCard, Rule, SliceRule, Variant } from './model'
import { fieldInfo } from './paths'
import { renderCanonForPrompt } from './prompt'
import { FAILURE_MODES } from './rubric'
import { RULE_FAMILIES } from './rules/index'
import { suggestDesign } from './suggest'
import { CANON_VERSION, hash } from './version'
import { hasAny, tokens } from './words'

type ChainStyle = NodeOf<'chain'>['style']

export interface CanonQuery {
  kind?: PieceKind
  archetype?: Archetype
  styles?: string[]
  centre?: {
    cut: GemCutId
    widthMm: number
    stone?: GemMaterialId
    setting?: 'prong' | 'basket' | 'bezel' | 'halfBezel' | 'flush'
  }
  ringSize?: RingSize
  heightMm?: number
  variant?: Variant
  /** Shoulders of a headed ring. */
  shoulder?: 'plain' | 'cathedral' | 'split'
  /** Pavé on the band (a ring) or on the body (a pendant). */
  accent?: boolean
  chain?: { style: ChainStyle; widthMm?: number; lengthMm?: number }
  /** The piece itself, when there is one: the reference is built from it instead. */
  spec?: PieceSpecInput
  design?: Design
  /** Size budget for the rendered pack, in estimated tokens (chars / 4). */
  budgetTokens?: number
  /** Exemplar cards, 2–4; fewer when fewer are relevant. */
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

/** Kinds each archetype can be built as (custom: any). */
const KINDS_FOR: Record<Archetype, readonly PieceKind[] | undefined> = {
  solitaire: ['ring'],
  halo: ['ring'],
  threeStone: ['ring'],
  eternity: ['ring'],
  band: ['ring'],
  signet: ['ring'],
  pendantSolitaire: ['pendant', 'necklace'],
  namePendant: ['pendant', 'necklace'],
  icedPendant: ['pendant', 'necklace'],
  medallion: ['pendant', 'necklace'],
  studs: ['earrings'],
  tennis: ['bracelet', 'necklace', 'chain'],
  cuban: ['chain', 'bracelet', 'necklace'],
  custom: undefined,
}

/** The rule family that is an archetype's own (relevance in the ranking). */
const FAMILY_OF: Record<Archetype, keyof typeof RULE_FAMILIES | undefined> = {
  solitaire: 'solitaire',
  halo: 'halo',
  threeStone: 'threeStone',
  eternity: 'rows',
  band: 'bands',
  signet: 'signet',
  pendantSolitaire: 'pendant',
  namePendant: 'pendant',
  icedPendant: 'iced',
  medallion: 'pendant',
  studs: 'earrings',
  tennis: 'chain',
  cuban: 'chain',
  custom: undefined,
}
const FAMILY: ReadonlyMap<string, string> = new Map(
  Object.entries(RULE_FAMILIES).flatMap(([family, rules]) => rules.map((r) => [r.id, family])),
)

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
/**
 * Warnings first, then the archetype's own family (so halo rules beat generic head rules on a
 * halo), then the most specific; piece-wide checks (unity, simulants) last.
 */
const rank = (r: Rule, archetype: Archetype) =>
  SEVERITY[r.severity] * 100 +
  (FAMILY.get(r.id) === FAMILY_OF[archetype] ? 120 : 0) +
  specificity(r) * 15 +
  CONFIDENCE[r.confidence] * 5 -
  (r.applies.nodeKind ? 0 : 60)

const clampTo = (x: number, path: string, lo = 0) => {
  const info = fieldInfo(path)
  return Math.min(info?.maximum ?? x, Math.max(info?.minimum ?? lo, lo, x))
}

/** The body node an archetype's height lands on, for clamping the query to its range. */
const HEIGHT_PATH: Partial<Record<Archetype, string>> = {
  medallion: 'relief.height',
  icedPendant: 'vectorBody.height',
  namePendant: 'vectorBody.height',
}

interface Sane {
  kind: PieceKind
  archetype: Archetype
  words: string[]
}

/**
 * The query as the canon can use it: style words trimmed to the spec's limits, sizes clamped to
 * the node ranges, and an archetype that cannot be built as the kind replaced by the kind's own.
 */
function sanitise(q: CanonQuery): Sane & { q: CanonQuery } {
  const words = (q.styles ?? q.spec?.style ?? [])
    .map((w) => w.slice(0, 40))
    .filter((w) => w.trim())
    .slice(0, 12)
  let archetype = q.archetype ?? q.spec?.archetype ?? (q.kind && ARCHETYPE_OF[q.kind]) ?? 'custom'
  const asked = q.kind ?? q.spec?.kind
  if (asked && KINDS_FOR[archetype] && !KINDS_FOR[archetype]!.includes(asked))
    archetype = ARCHETYPE_OF[asked] ?? 'custom'
  const kind = asked ?? KIND_OF[archetype]
  const heightPath = HEIGHT_PATH[archetype] ?? 'meshBody.height'
  return {
    kind,
    archetype,
    words,
    q: {
      ...q,
      ...(q.heightMm !== undefined ? { heightMm: clampTo(q.heightMm, heightPath, 5) } : {}),
      ...(q.centre ? { centre: { ...q.centre, widthMm: clampTo(q.centre.widthMm, 'gem.width') } } : {}),
    },
  }
}

function referenceSpec(q: CanonQuery, { kind, archetype, words }: Sane): PieceSpecInput {
  const pendant = kind === 'pendant' || kind === 'necklace'
  const H = q.heightMm ?? (archetype === 'icedPendant' ? 50 : undefined)
  const chain =
    q.chain && pendant
      ? {
          style: q.chain.style,
          lengthMm: q.chain.lengthMm ?? 508,
          widthMm: q.chain.widthMm ?? (q.chain.style === 'cuban' ? Math.max(3, Math.round(0.12 * (H ?? 50))) : 1.5),
        }
      : pendant
        ? // Pendants are judged on a chain: a Cuban at 12 % of an iced piece, fine cable otherwise.
          archetype === 'icedPendant'
          ? { style: 'cuban' as const, lengthMm: 559, widthMm: Math.max(3, Math.round(0.12 * (H ?? 50))) }
          : { style: 'cable' as const, lengthMm: 457, widthMm: 1.2 }
        : q.chain
          ? { style: q.chain.style, lengthMm: q.chain.lengthMm ?? 457, widthMm: q.chain.widthMm ?? 3 }
          : undefined
  return {
    kind,
    archetype,
    title: 'Canon query',
    summary: '',
    style: words,
    ...(kind === 'ring'
      ? {
          ring: {
            size: q.ringSize ?? { system: 'us', value: 6 },
            ...(q.shoulder ? { shoulder: q.shoulder } : {}),
          },
        }
      : {}),
    stones: [
      ...(q.centre
        ? [
            {
              role: 'center' as const,
              cut: q.centre.cut,
              widthMm: q.centre.widthMm,
              stone: q.centre.stone ?? 'diamond',
              ...(q.centre.setting ? { setting: q.centre.setting } : {}),
            },
          ]
        : []),
      ...(q.accent ? [{ role: kind === 'ring' ? ('accent' as const) : ('pave' as const) }] : []),
    ],
    // An iced query is read on the commonest iced form, a block initial.
    ...(H !== undefined
      ? { body: { heightMm: H, ...(archetype === 'icedPendant' ? { text: 'A' } : {}) } }
      : {}),
    ...(chain ? { chain } : {}),
  }
}

/** A signet's stone is not in the recipe: add it, flush when it fits the plate, else a bezel. */
function withSignetStone(d: Design, q: CanonQuery): Design {
  if (!q.centre || d.nodes.center) return d
  const stone = q.centre.stone ?? 'diamond'
  const setting = q.centre.setting ?? (q.centre.widthMm <= 4 ? 'flush' : 'bezel')
  return applyOps(d, [
    {
      t: 'add',
      node: {
        id: 'center',
        kind: 'gem',
        cut: q.centre.cut,
        stone,
        width: q.centre.widthMm,
        placement: { type: 'ringTop', shank: 'band', angle: 0, elevation: 0.6, spin: 0 },
      },
    },
    { t: 'add', node: { id: 'head', kind: 'setting', gem: 'center', style: setting } },
  ]).design
}

/** The reference design, or undefined when nothing can be built (a rules-only slice). */
function referenceDesign(q: CanonQuery, sane: Sane): Design | undefined {
  if (q.design) return q.design
  const spec = q.spec ? PieceSpecSchema.safeParse(q.spec) : undefined
  const input = spec?.success ? spec.data : referenceSpec(q, sane)
  const o = q.variant ? { variant: q.variant } : {}
  for (const build of [() => suggestDesign(input, o).design, () => buildDesign(input)]) {
    try {
      const d = build()
      return sane.archetype === 'signet' ? withSignetStone(d, q) : d
    } catch {
      // The next way, then none: a rules-only slice with expression bands.
    }
  }
  return undefined
}

/** Brief words an exemplar shares with the query: its style guides and its own style words. */
function wordOverlap(e: Exemplar, words: readonly string[], want: ReadonlySet<string>): number {
  const guides = matchStyles(e.styles).filter((g) => want.has(g.id)).length
  const own = e.styles.filter((s) => hasAny(words, [s])).length
  return guides + own
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

/**
 * Exemplars by relevance: the same archetype first (the same kind only for custom pieces or when
 * the archetype has too few), scored on cut family, relative size, variant and shared brief
 * words, then MMR for diversity. Returns fewer than `count` when fewer are relevant.
 */
function pickExemplars(q: CanonQuery, sane: Sane, count: number): Exemplar[] {
  const { kind, archetype, words } = sane
  const all = getExemplars()
  let pool = all.filter((e) => e.archetype === archetype)
  if (archetype === 'custom' || pool.length < count)
    pool = [...pool, ...all.filter((e) => e.archetype !== archetype && e.kind === kind)]
  const want = new Set(matchStyles(words).map((g) => g.id))
  const cutFamily = q.centre && GEM_CUTS[q.centre.cut]
  const size = q.centre?.widthMm ?? q.heightMm
  const scored = pool.map((e) => {
    const cut = e.read.centre && GEM_CUTS[e.read.centre.cut]
    const key = q.centre ? e.sizeKey.W : e.sizeKey.H
    const score =
      (e.archetype === archetype ? 4 : 0) +
      2 * wordOverlap(e, words, want) +
      (cut && cutFamily && cut.style === cutFamily.style && cut.outline === cutFamily.outline
        ? 1
        : 0) +
      (size && key ? 2 * Math.max(0, 1 - Math.abs(key - size) / size) : 0) +
      (q.variant && e.variant === q.variant ? 1 : 0)
    return { e, score }
  })
  const top = Math.max(1e-9, ...scored.map((s) => s.score))
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

/** Case- and plural-insensitive key for deduping caveats. */
const caveatKey = (s: string) =>
  tokens(s)
    .map((t) => t.replace(/s$/, ''))
    .join(' ')

/** Caveats for the piece, most relevant first: the archetype's own, then the kind's, then general. */
function caveatsFor(sane: Sane, guides: ReturnType<typeof matchStyles>) {
  const score = (c: Caveat) =>
    c.applies.styles && !hasAny(sane.words, c.applies.styles)
      ? -1
      : c.applies.archetypes
        ? c.applies.archetypes.includes(sane.archetype)
          ? 3
          : -1
        : c.applies.kinds
          ? c.applies.kinds.includes(sane.kind)
            ? 2
            : -1
          : 0
  const out = new Map<string, { feature: string; fallback: string; score: number }>()
  const push = (feature: string, fallback: string, s: number) => {
    const k = caveatKey(feature)
    const had = out.get(k)
    if (!had || had.score < s) out.set(k, { feature, fallback, score: s })
  }
  for (const c of CAVEATS) {
    const s = score(c)
    if (s >= 0) push(c.feature, c.fallback, s)
  }
  // A matched guide's own gaps are as relevant as the archetype's.
  for (const g of guides) for (const c of g.cannotExpress) push(c.feature, c.fallback, 3)
  return [...out.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ feature, fallback }) => ({ feature, fallback }))
}

/** Matched guides shown in a slice: the two best matches. */
const MAX_GUIDES = 2

/** The focused canon for a query: ranked rules with evaluated bands, style guides, exemplars. */
export function canonFor(query: CanonQuery): CanonSlice {
  const { q, ...sane } = sanitise(query)
  const { kind, archetype, words } = sane
  const guides = matchStyles(words)
  const design = referenceDesign(q, sane)
  const piece = design ? pieceFacts(design, { styles: words }) : {}
  const ctx = { kind, archetype, words }
  const nodes = design
    ? design.order.map((id) => design.nodes[id]).filter((n): n is Node => !!n)
    : []

  const ranked: { s: SliceRule; rank: number }[] = []
  const seen = new Set<string>()
  for (const rule of effectiveRules(guides)) {
    if (seen.has(rule.id) || !ruleApplies(rule, ctx)) continue
    const candidates = rule.applies.nodeKind
      ? nodes.filter((n) => n.kind === rule.applies.nodeKind)
      : design
        ? [undefined]
        : []
    // The first subject the rule holds for (a side stone, not the centre, for side-stone rules).
    const at = candidates.findIndex((n) =>
      whenHolds(rule, n && design ? nodeFacts(design, n.id, piece) : piece),
    )
    const found = candidates.length > 0
    if (found && at < 0) continue
    const subject = candidates[at]
    if (!found) {
      // Nothing in the reference to evaluate it on: keep the archetype's (or a custom piece's
      // kind's) own rules, printed as formulas; drop the generic ones.
      const own =
        rule.applies.archetypes?.includes(archetype) ||
        (archetype === 'custom' && rule.applies.kinds?.includes(kind))
      if (!own) continue
      seen.add(rule.id)
      ranked.push({ s: { rule }, rank: rank(rule, archetype) })
      continue
    }
    const facts = subject && design ? nodeFacts(design, subject.id, piece) : piece
    // Guards against something absent (a band of exactly 0) are noise when nothing trips them.
    if (rule.measure && design && evalExpr(rule.band.max, facts) === 0) {
      const m = MEASURES[rule.measure]?.({ design, facts, node: subject })
      if (!m || m.value === 0) continue
    }
    seen.add(rule.id)
    const band = bandFor(rule, facts, q.variant)
    ranked.push({ s: band ? { rule, band } : { rule }, rank: rank(rule, archetype) })
  }
  ranked.sort((a, b) => b.rank - a.rank)

  const exemplars = pickExemplars(q, sane, Math.min(4, Math.max(2, q.exemplars ?? 3))).map(card)
  let rules = ranked.map((r) => r.s)
  let styles = guides.slice(0, MAX_GUIDES)
  let cards = exemplars
  let caveats = caveatsFor(sane, styles).slice(0, 6)
  let failureModes = FAILURE_MODES.filter((f) => f.archetypes.includes(archetype))
    .slice(0, 5)
    .map((f) => f.text)
  const questions = QUESTIONS[archetype]
    .filter(
      (x) =>
        !(q.ringSize && x.startsWith('Ring size')) && !(q.centre && x.startsWith('Centre stone')),
    )
    .slice(0, 3)

  const make = (): CanonSlice => {
    const body = { version: CANON_VERSION, rules, styles, exemplars: cards, caveats, failureModes, questions }
    // The key is the content: any change to what the model would read changes it.
    const key = `${kind}/${archetype}/${hash(renderCanonForPrompt({ ...body, key: '' }))}`
    return { ...body, key }
  }
  const budget = q.budgetTokens ?? 1500
  const over = (x: CanonSlice) => renderCanonForPrompt(x).length / 4 > budget
  let s = make()
  // Shrink by section: surplus rules first, then style detail, the fourth and third exemplar
  // cards, caveats, failure modes, and only then the core rules.
  for (;;) {
    if (!over(s)) return s
    if (rules.length > 12) rules = rules.slice(0, -1)
    else if (styles.some((g) => g.recipes.length || g.do.length || g.dont.length))
      styles = styles.map((g) => ({ ...g, recipes: [], do: [], dont: [] }))
    else if (cards.length > 2) cards = cards.slice(0, -1)
    else if (caveats.length) caveats = caveats.slice(0, -1)
    else if (failureModes.length) failureModes = failureModes.slice(0, -1)
    else if (rules.length > 4) rules = rules.slice(0, -1)
    else return { ...s, overBudget: true }
    s = make()
  }
}
