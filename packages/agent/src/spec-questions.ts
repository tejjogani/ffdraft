/**
 * The spec questions asked before CAD is built from a picture ("Take to CAD"): what the piece is,
 * its size, the centre stone, the metal and the budget, as quick replies whose defaults are what
 * the picture showed. A picture cannot say how big a ring is or what it may cost, so these are
 * asked, not guessed; one press of Go accepts the read.
 *
 * Pure and deterministic: the same draft gives the same questions, so a recorded run replays.
 */
import {
  GEM_CUTS,
  type GemCutId,
  METALS,
  type MetalId,
  type PieceKind,
  type PieceSpec,
  type QuickQuestion,
  QuickQuestionSchema,
} from '@pave/schema'

const KIND_OPTIONS: { id: PieceKind; label: string }[] = [
  { id: 'ring', label: 'Ring' },
  { id: 'pendant', label: 'Pendant' },
  { id: 'earrings', label: 'Earrings' },
  { id: 'bracelet', label: 'Bracelet' },
  { id: 'necklace', label: 'Necklace' },
]

const METAL_OPTIONS: MetalId[] = [
  'au18k-yellow',
  'au18k-white',
  'au18k-rose',
  'au14k-yellow',
  'pt950',
]

/** Budget bands in USD, the upper edge of each (null: no ceiling). */
export const BUDGET_BANDS = [
  { id: 'none', label: 'No set budget', maxUsd: null },
  { id: 'under-1500', label: 'Under $1,500', maxUsd: 1500 },
  { id: 'to-3000', label: '$1,500–3,000', maxUsd: 3000 },
  { id: 'to-6000', label: '$3,000–6,000', maxUsd: 6000 },
  { id: 'over-6000', label: 'Over $6,000', maxUsd: null },
] as const

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''))
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)

function sizeQuestion(spec: PieceSpec): QuickQuestion {
  if (spec.kind === 'ring') {
    const size = spec.ring?.size
    // Sizes are offered in US sizes around the read's (US 6 when it had none).
    const us = size?.system === 'us' ? Math.round(size.value * 2) / 2 : 6
    const values = [...new Set([us - 1, us, us + 1, us + 2].map((v) => Math.max(3, v)))]
    return {
      id: 'size',
      question: 'Ring size?',
      options: values.map((v) => ({ id: slug(`us-${fmt(v)}`), label: `US ${fmt(v)}` })),
      multiple: false,
      defaults: [slug(`us-${fmt(us)}`)],
    }
  }
  if (spec.kind === 'bracelet' || spec.kind === 'necklace' || spec.kind === 'chain') {
    const lengths = spec.kind === 'bracelet' ? [160, 180, 200] : [400, 450, 500, 600]
    const at = spec.chain?.lengthMm ?? (spec.kind === 'bracelet' ? 180 : 450)
    const near = lengths.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a))
    return {
      id: 'size',
      question: 'Length?',
      options: lengths.map((mm) => ({ id: `len-${mm}`, label: `${mm / 10} cm` })),
      multiple: false,
      defaults: [`len-${near}`],
    }
  }
  const heights = [15, 20, 25, 35]
  const at = spec.body?.heightMm ?? 20
  const near = heights.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a))
  return {
    id: 'size',
    question: 'How tall?',
    options: heights.map((mm) => ({ id: `height-${mm}`, label: `${mm} mm` })),
    multiple: false,
    defaults: [`height-${near}`],
  }
}

function stoneQuestion(spec: PieceSpec): QuickQuestion {
  const center = spec.stones.find((s) => s.role === 'center')
  const cut: GemCutId = center?.cut ?? 'round'
  const ct = center?.carat ?? 1
  const label = (c: GemCutId, carat: number) =>
    `${GEM_CUTS[c].label.replace(' brilliant', '')} ${fmt(carat)} ct`
  const id = (c: GemCutId, carat: number) => slug(`${c}-${fmt(carat)}`)
  const options = new Map<string, string>()
  // The read's stone first, then a size either side, then the two most asked-for other cuts.
  for (const [c, carat] of [
    [cut, ct],
    [cut, Math.max(0.25, Math.round(ct * 0.5 * 4) / 4)],
    [cut, Math.round(ct * 1.5 * 4) / 4],
    [cut === 'oval' ? 'round' : 'oval', ct],
  ] as [GemCutId, number][])
    options.set(id(c, carat), label(c, carat))
  options.set('none', 'No centre stone')
  return {
    id: 'centre-stone',
    question: 'Centre stone?',
    options: [...options].map(([id, label]) => ({ id, label })),
    multiple: false,
    defaults: [center ? id(cut, ct) : 'none'],
  }
}

/** The five spec questions for a draft, each defaulting to what the picture showed. */
export function specQuestions(spec: PieceSpec): QuickQuestion[] {
  const kind = KIND_OPTIONS.some((k) => k.id === spec.kind) ? spec.kind : 'ring'
  const metal = METAL_OPTIONS.includes(spec.metal.alloy) ? spec.metal.alloy : 'au18k-yellow'
  const budget = spec.budgetUsd
    ? (BUDGET_BANDS.find((b) => b.maxUsd !== null && spec.budgetUsd! <= b.maxUsd) ??
      BUDGET_BANDS[4])
    : BUDGET_BANDS[0]
  const questions: QuickQuestion[] = [
    {
      id: 'kind',
      question: 'What is it?',
      options: KIND_OPTIONS,
      multiple: false,
      defaults: [kind],
    },
    sizeQuestion(spec),
    stoneQuestion(spec),
    {
      id: 'metal',
      question: 'Metal?',
      options: METAL_OPTIONS.map((m) => ({ id: m, label: METALS[m].label })),
      multiple: false,
      defaults: [metal],
    },
    {
      id: 'budget',
      question: 'Budget?',
      options: BUDGET_BANDS.map(({ id, label }) => ({ id, label })),
      multiple: false,
      defaults: [budget.id],
    },
  ]
  // Every question is checked against the schema chat.ask validates with.
  return questions.map((q) => QuickQuestionSchema.parse(q))
}
