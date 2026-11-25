/**
 * Canon-suggested parameters for a spec, keyed by the recipe's fixed node ids. `canonDefaults`
 * is the recipe hook of the brief (schema never imports canon); `suggestParameters` is the full
 * suggestion, which also corrects explicit spec values that break a canon warning, with a note.
 */
import {
  buildDesign,
  type Design,
  MELEE_SIZES_MM,
  mergePatch,
  type Node,
  NodeSchema,
  type PieceSpec,
  type PieceSpecInput,
  PieceSpecSchema,
  validateDesign,
} from '@pave/schema'
import {
  bandFor,
  type Evaluated,
  effectiveRules,
  lintRange,
  matchStyles,
  type PieceContext,
  ruleApplies,
  specificity,
  whenHolds,
} from './engine'
import { evalExpr } from './expr'
import { type Facts, nodeFacts, type PairWith, pieceFacts } from './facts'
import { MEASURES } from './measures'
import type { Rule, StyleGuide, Variant } from './model'
import { fieldInfo, patchFor, readPath, roundFor, splitPath } from './paths'
import { RULES_BY_ID } from './rules/index'
import { hasAny } from './words'

/**
 * Recipe parameters, in dependency order (halo melee, band, head, height, rows), each
 * the recipe node id plus the schema path it sets.
 */
export const RECIPE_PARAMS = {
  // The halo melee depends on the centre alone, and the band may follow it (rows.bandForHalo).
  'halo.stoneWidth': 'halo.stoneWidth',
  'band.widthTop': 'ringShank.widthTop',
  'band.widthBottom': 'ringShank.widthBottom',
  'band.thicknessBottom': 'ringShank.thicknessBottom',
  'band.thicknessTop': 'ringShank.thicknessTop',
  'band.splitGap': 'ringShank.splitGap',
  'band.profile': 'ringShank.profile',
  'face.width': 'relief.width',
  'face.height': 'relief.height',
  'face.baseThickness': 'relief.baseThickness',
  'head.style': 'setting.style',
  'sideHead1.style': 'setting.style',
  'sideHead2.style': 'setting.style',
  'head.prongCount': 'setting.prongCount',
  'head.prongSpin': 'setting.prongSpin',
  'sideHead1.prongSpin': 'setting.prongSpin',
  'sideHead2.prongSpin': 'setting.prongSpin',
  'head.prongDiameter': 'setting.prongDiameter',
  'head.taper': 'setting.taper',
  'head.wall': 'setting.wall',
  'center.spin': 'gem.placement.spin',
  'center.elevation': 'gem.placement.elevation',
  'head.rails': 'setting.rails',
  'band.shoulderHeight': 'ringShank.shoulderHeight',
  'band.baseShape': 'ringShank.baseShape',
  'halo.offset': 'halo.offset',
  'halo.drop': 'halo.drop',
  'side1.width': 'gem.width',
  'side2.width': 'gem.width',
  'side1.lw': 'gem.lw',
  'side2.lw': 'gem.lw',
  'side1.spin': 'gem.placement.spin',
  'side2.spin': 'gem.placement.spin',
  'side1.angle': 'gem.placement.angle',
  'side2.angle': 'gem.placement.angle',
  'side1.elevation': 'gem.placement.elevation',
  'side2.elevation': 'gem.placement.elevation',
  'sideHead1.prongCount': 'setting.prongCount',
  'sideHead2.prongCount': 'setting.prongCount',
  'sideHead1.prongDiameter': 'setting.prongDiameter',
  'sideHead2.prongDiameter': 'setting.prongDiameter',
  'sideHead1.taper': 'setting.taper',
  'sideHead2.taper': 'setting.taper',
  'row.setting': 'gemRow.setting',
  'row.rows': 'gemRow.rows',
  'row.stoneWidth': 'gemRow.stoneWidth',
  'row.gap': 'gemRow.gap',
  'row.coverage': 'gemRow.coverage',
  'row.skipCenter': 'gemRow.skipCenter',
  'body.thickness': 'vectorBody.thickness',
  'body.border': 'vectorBody.border',
  'body.flatBack': 'meshBody.flatBack',
  'body.hollow': 'meshBody.hollow',
  'ice.sizeMax': 'pave.sizeMax',
  'ice.sizeMin': 'pave.sizeMin',
  'ice.gap': 'pave.gap',
  'ice.margin': 'pave.margin',
  'ice.coverage': 'pave.coverage',
  'bail.style': 'bail.style',
  'bail.wire': 'bail.wire',
  'bail.opening': 'bail.opening',
  'bail.width': 'bail.width',
  'chain.linkWidth': 'chain.linkWidth',
  'chain.wire': 'chain.wire',
  'chain.length': 'chain.length',
  'post.wire': 'finding.wire',
  'post.length': 'finding.length',
  'metal.plating': 'ringShank.plating',
} as const
export type RecipeParam = keyof typeof RECIPE_PARAMS

/** The brief's recipe hook: (spec) → defaults; the recipe lets explicit spec fields win. */
export type RecipeDefaults = (spec: PieceSpec) => Partial<Record<RecipeParam, number | string>>

export interface Suggestion {
  values: Partial<Record<RecipeParam, number | string>>
  notes: { param: RecipeParam; ruleId: string; why: string; asked?: number | string }[]
}

/** Params an explicit spec field already decides (the recipe copies them through). */
function pinnedParams(input: PieceSpecInput): Set<RecipeParam> {
  const p = new Set<RecipeParam>()
  const add = (...keys: RecipeParam[]) => {
    for (const k of keys) p.add(k)
  }
  const stones = input.stones ?? []
  const role = (r: string) => stones.find((s) => s.role === r)
  const sized = (s: { carat?: number; widthMm?: number } | undefined) =>
    !!s && (s.carat !== undefined || s.widthMm !== undefined)
  if (input.ring?.bandWidthMm !== undefined) add('band.widthTop', 'band.widthBottom')
  if (input.ring?.bandThicknessMm !== undefined) add('band.thicknessTop')
  if (input.ring?.profile) add('band.profile')
  const c = role('center')
  if (c?.setting && c.setting !== 'prong') add('head.style')
  if (role('side')?.setting && role('side')?.setting !== 'prong')
    add('sideHead1.style', 'sideHead2.style')
  if (c?.prongs !== undefined) add('head.prongCount')
  const side = role('side')
  if (sized(side)) add('side1.width', 'side2.width')
  if (sized(role('halo'))) add('halo.stoneWidth')
  const accent = role('accent') ?? role('pave')
  if (sized(accent)) add(input.kind === 'ring' ? 'row.stoneWidth' : 'ice.sizeMax')
  if (accent?.setting === 'channel') add('row.setting')
  if (input.body?.iceLevel !== undefined) add('ice.coverage')
  if (input.body?.thicknessMm !== undefined) add('body.thickness')
  if (input.chain) add('chain.linkWidth', 'chain.length')
  // 'none' is the schema default: a parsed spec always carries it, so it decides nothing.
  if (input.metal?.plating && input.metal.plating !== 'none') add('metal.plating')
  return p
}

/** Words that name a variant, whole words only ("fine jewelry" and "statement" name none). */
const VARIANT_WORDS: Record<'delicate' | 'bold', readonly string[]> = {
  delicate: ['delicate', 'dainty', 'petite', 'stacking', 'stackable', 'slim', 'thin'],
  bold: ['bold', 'chunky', 'heavy', 'oversized'],
}
/** The variant a brief's words name, if any. */
const variantFromWords = (words: readonly string[]): Variant | undefined =>
  (['delicate', 'bold'] as const).find((v) => hasAny(words, VARIANT_WORDS[v]))

interface Candidate {
  value: number
  ruleId: string
  why: string
  /** The tightest lint thresholds and the rules that set them. */
  lint: { lo: number; hi: number; loId: string; hiId: string }
  /** The allowed interval: lint ranges and every compatible band. */
  lo: number
  hi: number
}

/** A style recipe that holds for this subject: the hero and its setting, never side stones. */
function recipeFor(
  path: string,
  facts: Facts,
  styles: readonly StyleGuide[],
  ctx: PieceContext,
  side: boolean,
) {
  if (side) return undefined
  for (const g of styles)
    for (const rec of g.recipes) {
      if (rec.path !== path) continue
      const a = rec.applies
      if (a?.kinds && !a.kinds.includes(ctx.kind)) continue
      if (a?.archetypes && !a.archetypes.includes(ctx.archetype)) continue
      if (a?.when !== undefined && (evalExpr(a.when, facts) ?? 0) === 0) continue
      const typical = evalExpr(rec.band.typical, facts)
      const min = evalExpr(rec.band.min, facts)
      const max = evalExpr(rec.band.max, facts)
      if (typical !== undefined && min !== undefined && max !== undefined)
        return { b: { typical, min, max }, id: g.id, why: rec.note ?? g.reads[0] ?? g.label }
    }
  return undefined
}

/**
 * The suggestion for one path: the intersection of every applicable lint range and rule band,
 * most specific first (a disjoint, less specific band is skipped), then the most specific
 * rule's typical value inside it. A matched style recipe is a preference inside that
 * intersection, never a way out of it. The note names the rule whose band produced the value.
 */
function candidate(
  path: string,
  node: Node,
  facts: Facts,
  rules: readonly Rule[],
  styles: readonly StyleGuide[],
  variant: Variant,
  ctx: PieceContext,
  side: boolean,
): Candidate | undefined {
  const bands: { b: Evaluated; id: string; why: string; spec: number }[] = []
  const lint = { lo: -Infinity, hi: Infinity, loId: '', hiId: '' }
  for (const r of rules) {
    if (!r.paths.includes(path) || !ruleApplies(r, ctx)) continue
    // A measure's band is in its own units (a ratio, a gap), not the parameter's: skip it here.
    if (
      r.measure ||
      (r.applies.nodeKind && r.applies.nodeKind !== node.kind) ||
      !whenHolds(r, facts)
    )
      continue
    if (r.severity !== 'default') {
      const range = lintRange(r, facts)
      if (range && range.lo > lint.lo) Object.assign(lint, { lo: range.lo, loId: r.id })
      if (range && range.hi < lint.hi) Object.assign(lint, { hi: range.hi, hiId: r.id })
    }
    const b = bandFor(r, facts, variant)
    if (b) bands.push({ b, id: r.id, why: r.rationale, spec: specificity(r) })
  }
  const recipe = recipeFor(path, facts, styles, ctx, side)
  if ((!bands.length && !recipe) || lint.lo > lint.hi + 1e-9) return undefined
  bands.sort((a, b) => b.spec - a.spec)
  let lo = { v: lint.lo, id: '' }
  let hi = { v: lint.hi, id: '' }
  for (const { b, id } of bands) {
    if (Math.max(lo.v, b.min) > Math.min(hi.v, b.max) + 1e-9) continue
    if (b.min > lo.v) lo = { v: b.min, id }
    if (b.max < hi.v) hi = { v: b.max, id }
  }
  const lead = bands[0]
  let target = lead?.b.typical ?? recipe!.b.typical
  let source = lead ? { id: lead.id, why: lead.why } : { id: recipe!.id, why: recipe!.why }
  if (recipe) {
    const plo = Math.max(lo.v, recipe.b.min)
    const phi = Math.min(hi.v, recipe.b.max)
    target = plo <= phi + 1e-9 ? Math.min(phi, Math.max(plo, recipe.b.typical)) : recipe.b.typical
    source = { id: recipe.id, why: recipe.why }
  }
  const clamped = Math.min(hi.v, Math.max(lo.v, target))
  if (clamped !== target) {
    const setter = clamped === lo.v ? lo.id : hi.id
    const r = setter ? RULES_BY_ID.get(setter) : undefined
    if (r) source = { id: r.id, why: r.rationale }
  }
  const value = roundFor(path, clamped, lo.v, hi.v)
  return { value, ruleId: source.id, why: source.why, lint, lo: lo.v, hi: hi.v }
}

/** Categorical choices, each made by code and justified by the rule it cites. */
interface ChoiceContext {
  design: Design
  pinned: ReadonlySet<RecipeParam>
}
type Choice = {
  ruleId: string
  pick: (f: Facts, n: Node, c: ChoiceContext) => string | undefined
}
const clawHead: Choice = {
  ruleId: 'ring.head.bareClaws',
  pick: (f, n, { design }) =>
    design.kind === 'ring' &&
    n.kind === 'setting' &&
    n.style === 'prong' &&
    f.W !== undefined &&
    f.wire !== undefined
      ? // East-west sits low, and low is basket or bezel only (09 §1 elevation class).
        f.W >= 4.5 || (f.free ?? 0) > 3 * f.wire || (f.eastWest && f.hero)
        ? 'basket'
        : 'prong'
      : undefined,
}
const sharedMax = (f: Facts) =>
  f.bandW === undefined ? undefined : lintRange(RULES_BY_ID.get('rows.sharedProng')!, f)?.hi
const walledMax = (f: Facts) =>
  f.bandW === undefined ? undefined : lintRange(RULES_BY_ID.get('rows.walledPave')!, f)?.hi
const CHOICES: Partial<Record<RecipeParam, Choice>> = {
  'head.style': clawHead,
  'sideHead1.style': clawHead,
  'sideHead2.style': clawHead,
  'band.profile': {
    ruleId: 'rows.flatProfile',
    pick: (f) => ((f.rowD ?? 0) > 0 && !f.shared ? 'flatCourt' : undefined),
  },
  'band.baseShape': {
    ruleId: 'ring.base.euro',
    pick: (f) => {
      const rule = RULES_BY_ID.get('ring.base.euro')
      return rule && f.head && evalExpr(rule.band.typical, f) === 1 ? 'euro' : undefined
    },
  },
  'row.setting': {
    // A chosen pavé size too big for walled seats but inside shared claws: the jeweler's
    // stand-in for fine pavé (09 §1 "Shared prong"; French/U-cut is a maker note).
    ruleId: 'rows.sharedProng',
    pick: (f, n, { pinned }) => {
      if (n.kind !== 'gemRow' || n.setting !== 'pave') return undefined
      // Walled seats on arched cathedral shoulders fail the kernel's seat check; shared claws pass.
      if (f.cathedral) return 'sharedProng'
      if (!pinned.has('row.stoneWidth')) return undefined
      const walled = walledMax(f)
      const shared = sharedMax(f)
      return walled !== undefined &&
        shared !== undefined &&
        n.stoneWidth > walled + 1e-6 &&
        n.stoneWidth <= shared + 1e-6
        ? 'sharedProng'
        : undefined
    },
  },
  'bail.style': {
    // The kernel's loop hole is a narrow teardrop (twice the link to pass a chain): a ring on
    // fine round chain, a tube on everything heavier (09 §2 "Bail and chain"), and behind a
    // flooded sculpt or plate a hidden bail, which leaves its top stones clear.
    ruleId: 'bail.chainStyle',
    pick: (f, n, { design }) => {
      if (n.kind !== 'bail' || f.chainW === undefined) return undefined
      const host = n.host ? design.nodes[n.host] : undefined
      const iced = Object.values(design.nodes).some((p) => p?.kind === 'pave' && p.host === n.host)
      // A letter is open where a slot hangs: its counter (A, O, R) or the gaps between its
      // strokes (M, V, W). Behind a 32 mm block letter the kernel saw the slot from the front on
      // all but T, so a letter hangs from a bail on top, which clears its top stones too.
      const text = host?.kind === 'vectorBody' && host.source.type === 'text'
      if (iced && !text) return 'hidden'
      return f.chainW <= 2 && !f.flatLink && !f.tennis ? 'ring' : 'tube'
    },
  },
}

/** Applies a patch to one node (schema defaults and ranges enforced) in a working copy. */
function patchNode(d: Design, id: string, patch: Record<string, unknown>): Design {
  const node = NodeSchema.parse(mergePatch(d.nodes[id], patch))
  return { ...d, nodes: { ...d.nodes, [id]: node } }
}

/** Three passes settle the coupled params (three-stone angle ↔ elevation) to a fixed point. */
const PASSES = 3

const sameValue = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b

const pairOf = (o: { pairWith?: PairWith }) => (o.pairWith ? { pairWith: o.pairWith } : {})

export interface SuggestOptions {
  variant?: Variant
  /** The engagement shank a wedding band is made for (band.pair.*). */
  pairWith?: PairWith
  /**
   * false: explicit spec values are never corrected, so every other value is computed for the
   * design the recipe will actually build (the recipe hook). Default true.
   */
  correct?: boolean
}

type Note = Suggestion['notes'][number]

/**
 * Builds `spec` with the plain recipe, then walks the recipe params in dependency order (three
 * times, until coupled values settle) and sets each to the canon's band for its context.
 * Returns the values and the design they produce.
 */
export function suggestDesign(
  spec: PieceSpecInput,
  o: SuggestOptions = {},
): Suggestion & { design: Design } {
  const parsed = PieceSpecSchema.parse(spec)
  const words = parsed.style
  const styles = matchStyles(words)
  const rules = effectiveRules(styles)
  const variant = o.variant ?? variantFromWords(words) ?? 'classic'
  const ctx = { kind: parsed.kind, archetype: parsed.archetype, words }
  const pinned = pinnedParams(spec)
  // The band follows the stones only when they were chosen first, or on an eternity, whose stone
  // size is the design; otherwise the stones follow the band.
  const followStones = pinned.has('row.stoneWidth') || parsed.archetype === 'eternity'
  const bandRules = followStones ? rules : rules.filter((r) => r.id !== 'rows.bandForStones')
  // An eternity with nothing pinned takes its stone from the variant's scale and its band from
  // the stone, so the row is not held to the recipe's first band while the band catches up.
  const stoneFirst =
    parsed.archetype === 'eternity' && !pinned.has('band.widthTop') && !pinned.has('row.stoneWidth')
  const rowRules = stoneFirst
    ? rules.filter((r) => r.id !== 'rows.walledPave' && r.id !== 'rows.sharedProng')
    : rules
  let design = buildDesign(spec)
  const values: Suggestion['values'] = {}
  const notes = new Map<RecipeParam, Note>()

  const set = (
    key: RecipeParam,
    id: string,
    patch: Record<string, unknown>,
    value: number | string,
    note: Note,
  ) => {
    try {
      design = patchNode(design, id, patch)
    } catch {
      return
    }
    values[key] = value
    notes.set(key, note)
  }

  for (let pass = 0; pass < PASSES; pass++) {
    for (const key of Object.keys(RECIPE_PARAMS) as RecipeParam[]) {
      const path = RECIPE_PARAMS[key]
      if (key === 'metal.plating') {
        if (pinned.has(key)) continue
        for (const id of design.order) {
          const n = design.nodes[id]
          if (n && 'plating' in n && n.plating === 'none' && /^au\d+k-white$/.test(n.material))
            set(key, id, { plating: 'rhodium' }, 'rhodium', {
              param: key,
              ruleId: 'metals.rhodium',
              why: RULES_BY_ID.get('metals.rhodium')!.rationale,
            })
        }
        continue
      }
      const id = key.split('.')[0]!
      const node = design.nodes[id]
      if (!node || node.kind !== splitPath(path)?.kind) continue
      const facts = nodeFacts(design, id, pieceFacts(design, { styles: words, ...pairOf(o) }))
      const choice = CHOICES[key]
      if (choice) {
        if (pinned.has(key)) continue
        const value = choice.pick(facts, node, { design, pinned })
        if (value !== undefined && fieldInfo(path)?.enum?.includes(value))
          set(key, id, patchFor(node, path, value), value, {
            param: key,
            ruleId: choice.ruleId,
            why:
              key === 'row.setting'
                ? 'Too large for walled seats on this band: shared claws hold it (the setter may cut it French or U).'
                : (RULES_BY_ID.get(choice.ruleId)?.rationale ?? ''),
          })
        continue
      }
      const c = candidate(
        path,
        node,
        facts,
        key.startsWith('band.') ? bandRules : key === 'row.stoneWidth' ? rowRules : rules,
        styles,
        variant,
        ctx,
        id.startsWith('side'),
      )
      if (!c) continue
      const current = readPath(node, path)
      if (pinned.has(key)) {
        // Explicit values win unless they break a canon warning; then move them to the nearest
        // value the canon allows and say why.
        if (
          o.correct === false ||
          current === undefined ||
          (current >= c.lint.lo - 1e-6 && current <= c.lint.hi + 1e-6)
        )
          continue
        const lo = c.lint.lo
        const hi = c.lint.hi
        const nearest = roundFor(path, Math.min(hi, Math.max(lo, current)), lo, hi)
        const by = current > c.lint.hi ? c.lint.hiId : c.lint.loId
        set(key, id, patchFor(node, path, nearest), nearest, {
          param: key,
          ruleId: by,
          why: RULES_BY_ID.get(by)?.rationale ?? c.why,
          asked: current,
        })
        continue
      }
      if (pass > 0 && sameValue(current, c.value) && notes.has(key)) continue
      set(key, id, patchFor(node, path, c.value), c.value, {
        param: key,
        ruleId: c.ruleId,
        why: c.why,
      })
    }
    design = settleMeleeZones(design, pinned, values, notes)
  }
  if (validateDesign(design).some((i) => i.level === 'error'))
    throw new Error('canon suggestion broke the design')
  return { values, notes: [...notes.values()], design }
}

/** Stock melee sizes inside [lo, hi], nearest `target` first. */
const stockIn = (lo: number, hi: number, target: number) =>
  MELEE_SIZES_MM.filter((m) => m >= lo - 1e-9 && m <= hi + 1e-9).sort(
    (a, b) => Math.abs(a - target) - Math.abs(b - target) || b - a,
  )

/**
 * Touching melee zones must match (within 0.1 mm) or step clearly (0.4 mm+), 09 §1 "Melee
 * zones". The halo is sized from the centre (halo.melee); the row gives way: it takes the halo
 * size when its band allows (rows.bandForHalo widens an open band to halo + 1.0), else one stock
 * size both zones accept, else it steps at least 0.4 mm below the halo.
 */
function settleMeleeZones(
  d: Design,
  pinned: ReadonlySet<RecipeParam>,
  values: Suggestion['values'],
  notes: Map<RecipeParam, Note>,
): Design {
  const halo = d.nodes.halo
  const row = d.nodes.row
  const clash = MEASURES.meleeStep?.({ design: d, facts: {} })?.value === 1
  if (!clash || halo?.kind !== 'halo' || row?.kind !== 'gemRow' || pinned.has('row.stoneWidth'))
    return d
  const rowRule = RULES_BY_ID.get(
    row.setting === 'sharedProng' ? 'rows.sharedProng' : 'rows.walledPave',
  )!
  const rowMax = lintRange(rowRule, nodeFacts(d, 'row'))?.hi ?? 0
  const haloRange = lintRange(RULES_BY_ID.get('halo.melee')!, nodeFacts(d, 'halo'))
  const why = RULES_BY_ID.get('halo.meleeZones')!.rationale
  const setRow = (w: number) => {
    values['row.stoneWidth'] = w
    notes.set('row.stoneWidth', { param: 'row.stoneWidth', ruleId: 'halo.meleeZones', why })
    return patchNode(d, 'row', { stoneWidth: w })
  }
  if (halo.stoneWidth <= rowMax + 1e-9) return setRow(halo.stoneWidth)
  // An open band follows the halo on the next pass; only a pinned band makes the row give way.
  if (!pinned.has('band.widthTop')) return d
  const shared =
    !pinned.has('halo.stoneWidth') && haloRange
      ? stockIn(haloRange.lo, Math.min(haloRange.hi, rowMax), halo.stoneWidth)[0]
      : undefined
  if (shared !== undefined) {
    values['halo.stoneWidth'] = shared
    notes.set('halo.stoneWidth', { param: 'halo.stoneWidth', ruleId: 'halo.meleeZones', why })
    d = patchNode(d, 'halo', { stoneWidth: shared })
    return setRow(shared)
  }
  const stepped = stockIn(0.8, Math.min(rowMax, halo.stoneWidth - 0.4), Infinity)[0]
  return stepped === undefined ? d : setRow(stepped)
}

/** The canon's suggestion for a spec: values by recipe param and why each was chosen. */
export function suggestParameters(spec: PieceSpecInput, o: SuggestOptions = {}): Suggestion {
  const { values, notes } = suggestDesign(spec, o)
  return { values, notes }
}

/**
 * The recipe hook: canon values for everything the spec leaves open, computed with the spec's
 * explicit values held as given (the recipe lets them win), so every dependent value matches
 * the design the recipe builds. The assistant offers corrections from `suggestParameters`.
 */
export const canonDefaults: RecipeDefaults = (spec) =>
  suggestParameters(spec, { correct: false }).values
