/**
 * The Replace stone dialog's model, pure: what the designer has chosen, the `StoneChange` it
 * means, and what the stone will be. A value left untouched is not sent, so the intent's own
 * rule decides it: a new cut keeps a single stone's carat and a field's millimetres, and the
 * length : width follows the new cut.
 */
import {
  applyOps,
  type Design,
  type EvaluationSummary,
  fittedCarat,
  GEM_CUTS,
  type GemCutId,
  type GemMaterialId,
  gemDims,
  gemDimsFromCarat,
  IntentError,
  type IntentResult,
  type IntentWarning,
  type NodeOf,
  type Op,
  replaceStone,
  resolveDesign,
  type StoneChange,
  type StoneTarget,
  stoneDims,
} from '@pave/schema'
import { CARAT_STEPS, fmtCarat, isFancy, isStoneNode, type Subject } from './quick-intents'

type Gem = NodeOf<'gem'>
type Field = NodeOf<'gemRow'> | NodeOf<'halo'> | NodeOf<'pave'>

export interface StoneForm {
  cut: GemCutId
  /** The size as typed, in `unit`; null while untouched. */
  size: number | null
  /** A single stone is talked about in carats; melee only ever in millimetres. */
  unit: 'mm' | 'ct'
  /** Length : width as typed; null while untouched (it follows the cut). */
  lw: number | null
  stone: GemMaterialId
  /** Three-stone: also resize the side stones to keep the proportion. */
  sides: 'keep' | 'proportion'
  /** A side stone with a matching partner: change both (the default, a pair is bought as one) or only this one. */
  pair: 'both' | 'one'
  /** The warnings' ready fixes the designer added to this change, by `Fix.key`. */
  fixes: string[]
}

export function initialForm(node: Gem | Field): StoneForm {
  return {
    cut: node.cut,
    size: null,
    unit: node.kind === 'gem' ? 'ct' : 'mm',
    lw: null,
    stone: node.stone,
    sides: 'keep',
    pair: 'both',
    fixes: [],
  }
}

/**
 * A side stone's partner across the centre: on the same band, on the other side, and alike
 * (cut, material and width), as the intent's `side.pair` check finds it. Only when the stone
 * and its partner are the only stones alike in the piece, since scope `alike` changes every
 * one of them (three equal stones would take the centre along).
 */
export function sidePartner(design: Design, node: Gem | Field): Gem | null {
  if (node.kind !== 'gem') return null
  const at = node.placement
  if (at.type !== 'ringTop' || !at.side) return null
  const width = stoneDims(node).width
  const alike = design.order
    .map((id) => design.nodes[id])
    .filter(
      (n): n is Gem =>
        n?.kind === 'gem' &&
        n.cut === node.cut &&
        n.stone === node.stone &&
        Math.abs(stoneDims(n).width - width) < 0.005,
    )
  const partner = alike.find(
    (n) =>
      n.placement.type === 'ringTop' &&
      n.placement.shank === at.shank &&
      n.placement.side === (at.side === 'left' ? 'right' : 'left'),
  )
  return partner && alike.length === 2 ? partner : null
}

/** The intent's change for a form: only what the designer actually changed. */
export function toChange(form: StoneForm, node: Gem | Field): StoneChange {
  const change: StoneChange = {}
  if (form.cut !== node.cut) change.cut = form.cut
  if (form.stone !== node.stone) change.stone = form.stone
  if (form.size !== null && form.size > 0) {
    if (form.unit === 'ct' && node.kind === 'gem') change.carat = form.size
    else change.widthMm = form.size
  }
  if (form.lw !== null && node.kind === 'gem' && isFancy(form.cut)) change.lw = form.lw
  if (form.sides === 'proportion') change.sides = 'proportion'
  return change
}

/** What one stone of the target will be: the numbers the form shows while untouched. */
export interface StoneOutcome {
  cut: GemCutId
  widthMm: number
  lengthMm: number
  lw: number
  /** Weight of one stone. */
  carat: number
}

/** A warning's ready edit, offered as "also do this" in the same change. */
export interface Fix {
  key: string
  label: string
  ops: Op[]
}

export interface Plan {
  /** What the intent was asked to change: the stone, or with its partner (scope `alike`). */
  target: StoneTarget
  change: StoneChange
  result: IntentResult | null
  /** The intent refused the change (a size outside every range, say). */
  error: string | null
  outcome: StoneOutcome | null
  /** A side stone's partner, when "Both side stones" is on offer. */
  partner: Gem | null
  /** The warnings' ready fixes, besides the ones the form has controls for. */
  fixes: Fix[]
}

/** A fix is known by what it edits, not its wording, so it stays chosen while the size moves. */
const fixKey = (w: IntentWarning, ops: Op[]) =>
  `${w.code}:${w.nodeId ?? ''}:${JSON.stringify(ops.map((op) => (op.t === 'update' ? [op.id, Object.keys(op.patch)] : op)))}`

/** Runs the pure intent on the form, exactly as Apply will. */
export function planReplace(
  design: Design,
  subject: Extract<Subject, { type: 'stone' }>,
  form: StoneForm,
): Plan {
  const node = design.nodes[subject.nodeId]
  const empty = { result: null, outcome: null, partner: null, fixes: [] }
  if (!isStoneNode(node))
    return {
      ...empty,
      target: { nodeId: subject.nodeId },
      change: {},
      error: 'That stone is no longer there',
    }
  const change = toChange(form, node)
  const partner = sidePartner(design, node)
  // A field is addressed whole: one stone there shares its seat and spacing with the rest.
  const target: StoneTarget = {
    nodeId: node.id,
    ...(partner && form.pair === 'both' ? { scope: 'alike' as const } : {}),
  }
  let result: IntentResult
  try {
    result = replaceStone(design, target, change)
  } catch (err) {
    if (err instanceof IntentError) return { ...empty, target, change, partner, error: err.message }
    throw err
  }
  const fixes = result.warnings.flatMap((w): Fix[] => {
    // The form's own controls cover these: the side-stones checkbox and the pair choice.
    if (!w.suggestion?.ops.length || w.code === 'side.proportion') return []
    if (w.code === 'side.pair' && partner) return []
    return [{ key: fixKey(w, w.suggestion.ops), label: w.suggestion.label, ops: w.suggestion.ops }]
  })
  const after = resolveDesign(applyOps(design, result.ops).design).nodes[node.id]
  return {
    target,
    change,
    result,
    error: null,
    outcome: after ? outcomeOf(after as Gem | Field) : null,
    partner,
    fixes,
  }
}

/** The ops Apply commits: the intent's, then each fix the designer added, in one change. */
export const opsToApply = (plan: Plan, form: StoneForm): Op[] => [
  ...(plan.result?.ops ?? []),
  ...plan.fixes.filter((f) => form.fixes.includes(f.key)).flatMap((f) => f.ops),
]

/** The smallest single stone the dialog offers as a centre stone: the bottom stock weight. */
export const CENTRE_MIN_CT = CARAT_STEPS[0]

/**
 * The size field's range in the form's unit. A centre stone stops at the smallest stock weight
 * (0.10 ct), as "Make it smaller" does, so a slip of the keyboard cannot plan a 0.00 ct centre;
 * a side stone or an accent can go down to the stone field's own minimum.
 */
export function sizeRange(
  node: Gem | Field,
  form: StoneForm,
  role?: Extract<Subject, { type: 'stone' }>['role'],
): { min: number; max: number; step: number } {
  if (node.kind !== 'gem') return { min: 0.8, max: 6, step: 0.05 }
  const centre = role === 'center'
  if (form.unit === 'ct') return { min: centre ? CENTRE_MIN_CT : 0.01, max: 100, step: 0.01 }
  const lw = form.lw ?? undefined
  const min = centre
    ? Math.ceil(gemDimsFromCarat(form.cut, CENTRE_MIN_CT, form.stone, lw).width * 100) / 100
    : 0.6
  return { min, max: 40, step: 0.01 }
}

function outcomeOf(n: Gem | Field): StoneOutcome {
  const dims =
    n.kind === 'gem' ? stoneDims(n) : gemDims(n.cut, n.kind === 'pave' ? n.sizeMax : n.stoneWidth)
  return {
    cut: n.cut,
    widthMm: dims.width,
    lengthMm: dims.length,
    lw: dims.length / dims.width,
    carat: fittedCarat(n.cut, dims, n.stone, n.kind === 'gem' ? n.sourcing : undefined),
  }
}

/** The form's size field while untouched: the outcome in the form's unit, to 0.01. */
export const shownSize = (form: StoneForm, outcome: StoneOutcome | null): number | null =>
  form.size ??
  (outcome ? Number((form.unit === 'ct' ? outcome.carat : outcome.widthMm).toFixed(2)) : null)

/** Switching unit keeps a typed size meaning the same stone. */
export function switchUnit(form: StoneForm, unit: StoneForm['unit'], outcome: StoneOutcome | null) {
  if (unit === form.unit) return form
  if (form.size === null || !outcome) return { ...form, unit }
  return {
    ...form,
    unit,
    size: Number((unit === 'ct' ? outcome.carat : outcome.widthMm).toFixed(2)),
  }
}

/** A cut's allowed length : width, for the ratio field. */
export const ratioRange = (cut: GemCutId) => GEM_CUTS[cut].lw

// ── The before / after facts from a dry run ──────────────────────────────────────────────────

export interface FactRow {
  label: string
  before: string
  after: string
  /** Signed change, or null when nothing changed. */
  delta: string | null
}

const signed = (v: number, unit: string, digits: number) => {
  const r = Number(v.toFixed(digits))
  if (r === 0) return null
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(digits)} ${unit}`.trim()
}

/** Weight, carats and stone count before and after, as the dialog lists them. */
export function factRows(
  before: Pick<EvaluationSummary, 'metalMassG' | 'caratTotal' | 'stoneCount'>,
  after: Pick<EvaluationSummary, 'metalMassG' | 'caratTotal' | 'stoneCount'>,
): FactRow[] {
  return [
    {
      label: 'Metal',
      before: `${before.metalMassG.toFixed(2)} g`,
      after: `${after.metalMassG.toFixed(2)} g`,
      delta: signed(after.metalMassG - before.metalMassG, 'g', 2),
    },
    {
      label: 'Carats',
      before: `${fmtCarat(before.caratTotal)} ct`,
      after: `${fmtCarat(after.caratTotal)} ct`,
      delta: signed(after.caratTotal - before.caratTotal, 'ct', 2),
    },
    {
      label: 'Stones',
      before: String(before.stoneCount),
      after: String(after.stoneCount),
      delta: signed(after.stoneCount - before.stoneCount, '', 0),
    },
  ]
}
