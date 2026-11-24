/**
 * Canon-suggested parameters for a spec, keyed by the recipe's fixed node ids. `canonDefaults`
 * is the recipe hook of the brief (schema never imports canon); `suggestParameters` is the full
 * suggestion, which also corrects explicit spec values that break a canon warning, with a note.
 */
import {
  buildDesign,
  type Design,
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
  ruleApplies,
  specificity,
  whenHolds,
} from './engine'
import { evalExpr } from './expr'
import { type Facts, nodeFacts, pieceFacts } from './facts'
import { MEASURES } from './measures'
import type { Rule, StyleGuide, Variant } from './model'
import { fieldInfo, patchFor, readPath, roundFor, splitPath } from './paths'
import { RULES_BY_ID } from './rules/index'

/**
 * Recipe parameters, in dependency order (band before head before height before rows), each
 * the recipe node id plus the schema path it sets.
 */
export const RECIPE_PARAMS = {
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
  'head.prongDiameter': 'setting.prongDiameter',
  'head.taper': 'setting.taper',
  'head.wall': 'setting.wall',
  'center.spin': 'gem.placement.spin',
  'center.elevation': 'gem.placement.elevation',
  'head.rails': 'setting.rails',
  'band.shoulderHeight': 'ringShank.shoulderHeight',
  'band.baseShape': 'ringShank.baseShape',
  'halo.stoneWidth': 'halo.stoneWidth',
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
  'row.rows': 'gemRow.rows',
  'row.stoneWidth': 'gemRow.stoneWidth',
  'row.gap': 'gemRow.gap',
  'row.coverage': 'gemRow.coverage',
  'row.skipCenter': 'gemRow.skipCenter',
  'body.thickness': 'vectorBody.thickness',
  'body.border': 'vectorBody.border',
  'body.flatBack': 'meshBody.flatBack',
  'ice.sizeMax': 'pave.sizeMax',
  'ice.sizeMin': 'pave.sizeMin',
  'ice.gap': 'pave.gap',
  'ice.margin': 'pave.margin',
  'ice.coverage': 'pave.coverage',
  'bail.style': 'bail.style',
  'bail.opening': 'bail.opening',
  'bail.wire': 'bail.wire',
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
  if (input.body?.iceLevel !== undefined) add('ice.coverage')
  if (input.body?.thicknessMm !== undefined) add('body.thickness')
  if (input.chain) add('chain.linkWidth', 'chain.length')
  if (input.metal?.plating) add('metal.plating')
  return p
}

const VARIANT_WORDS: Record<Variant, string[]> = {
  delicate: ['delicate', 'dainty', 'petite', 'fine', 'stacking', 'slim'],
  classic: ['classic'],
  bold: ['bold', 'statement', 'chunky', 'heavy', 'big'],
}
/** The variant a brief's words name, if any. */
function variantFromWords(words: readonly string[]): Variant | undefined {
  const w = words.map((x) => x.toLowerCase())
  return (['delicate', 'bold'] as const).find((v) =>
    VARIANT_WORDS[v].some((k) => w.some((x) => x.includes(k))),
  )
}

interface Candidate {
  value: number
  ruleId: string
  why: string
  lint: { lo: number; hi: number }
}

/** Every applicable band for a path, most specific first; style recipes are the most specific. */
function candidate(
  path: string,
  node: Node,
  facts: Facts,
  rules: readonly Rule[],
  styles: readonly StyleGuide[],
  variant: Variant,
  ctx: Parameters<typeof ruleApplies>[1],
  side: boolean,
): Candidate | undefined {
  const bands: { b: Evaluated; id: string; why: string; spec: number }[] = []
  let lint = { lo: -Infinity, hi: Infinity }
  for (const r of rules) {
    if (!r.paths.includes(path) || r.expressible === false || !ruleApplies(r, ctx)) continue
    // A measure's band is in its own units (a ratio, a gap), not the parameter's: skip it here.
    if (
      r.measure ||
      (r.applies.nodeKind && r.applies.nodeKind !== node.kind) ||
      !whenHolds(r, facts)
    )
      continue
    if (r.severity !== 'default') {
      const range = lintRange(r, facts)
      if (range) lint = { lo: Math.max(lint.lo, range.lo), hi: Math.min(lint.hi, range.hi) }
    }
    const b = bandFor(r, facts, variant)
    if (b) bands.push({ b, id: r.id, why: r.rationale, spec: specificity(r) })
  }
  // Style recipes describe the hero and its setting, never the side stones.
  for (const g of side ? [] : styles)
    for (const rec of g.recipes) {
      if (rec.path !== path) continue
      const typical = evalExpr(rec.band.typical, facts)
      const min = evalExpr(rec.band.min, facts)
      const max = evalExpr(rec.band.max, facts)
      if (typical !== undefined && min !== undefined && max !== undefined)
        bands.push({ b: { typical, min, max }, id: g.id, why: g.reads[0] ?? g.label, spec: 10 })
    }
  if (!bands.length) return undefined
  bands.sort((a, b) => b.spec - a.spec)
  const first = bands[0]!
  let lo = lint.lo
  let hi = lint.hi
  if (lo > hi) return undefined
  for (const { b } of bands) {
    const nlo = Math.max(lo, b.min)
    const nhi = Math.min(hi, b.max)
    if (nlo > nhi + 1e-9) continue
    lo = nlo
    hi = nhi
  }
  const value = roundFor(path, Math.min(hi, Math.max(lo, first.b.typical)), lo, hi)
  return { value, ruleId: first.id, why: first.why, lint }
}

/** Categorical choices, each made by code and justified by the rule it cites. */
type Choice = { ruleId: string; pick: (f: Facts, n: Node, d: Design) => string | undefined }
const clawHead: Choice = {
  ruleId: 'ring.head.bareClaws',
  pick: (f, n, d) =>
    d.kind === 'ring' &&
    n.kind === 'setting' &&
    n.style === 'prong' &&
    f.W !== undefined &&
    f.wire !== undefined
      ? f.W >= 4.5 || (f.free ?? 0) > 3 * f.wire
        ? 'basket'
        : 'prong'
      : undefined,
}
const CHOICES: Partial<Record<RecipeParam, Choice>> = {
  'head.style': clawHead,
  'sideHead1.style': clawHead,
  'sideHead2.style': clawHead,
  'band.profile': {
    ruleId: 'rows.flatProfile',
    pick: (f) => ((f.rowCov ?? 0) >= 240 && !f.shared ? 'flatCourt' : undefined),
  },
  'band.baseShape': {
    ruleId: 'ring.base.euro',
    pick: (f) => {
      const rule = RULES_BY_ID.get('ring.base.euro')
      return rule && f.head && evalExpr(rule.band.typical, f) === 1 ? 'euro' : undefined
    },
  },
  'bail.style': {
    ruleId: 'bail.roundChain',
    pick: (f, n) =>
      f.roundChain && n.kind === 'bail' && (n.style === 'loop' || n.style === 'hidden')
        ? 'tube'
        : undefined,
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

/**
 * Builds `spec` with the plain recipe, then walks the recipe params in dependency order (three
 * times, until coupled values settle) and sets each to the canon's band for its context.
 * Returns the values and the design they produce.
 */
export function suggestDesign(
  spec: PieceSpecInput,
  o: { variant?: Variant } = {},
): Suggestion & { design: Design } {
  const parsed = PieceSpecSchema.parse(spec)
  const words = parsed.style
  const styles = matchStyles(words)
  const rules = effectiveRules(styles)
  const variant = o.variant ?? variantFromWords(words) ?? 'classic'
  const ctx = { kind: parsed.kind, archetype: parsed.archetype, words }
  const pinned = pinnedParams(spec)
  let design = buildDesign(spec)
  const values: Suggestion['values'] = {}
  const notes = new Map<RecipeParam, Suggestion['notes'][number]>()

  const set = (
    key: RecipeParam,
    id: string,
    patch: Record<string, unknown>,
    value: number | string,
    note: Suggestion['notes'][number],
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
      const facts = nodeFacts(design, id, pieceFacts(design, { styles: words }))
      const choice = CHOICES[key]
      if (choice) {
        if (pinned.has(key)) continue
        const value = choice.pick(facts, node, design)
        if (value !== undefined && fieldInfo(path)?.enum?.includes(value))
          set(key, id, patchFor(node, path, value), value, {
            param: key,
            ruleId: choice.ruleId,
            why: RULES_BY_ID.get(choice.ruleId)?.rationale ?? '',
          })
        continue
      }
      const c = candidate(path, node, facts, rules, styles, variant, ctx, id.startsWith('side'))
      if (!c) continue
      const current = readPath(node, path)
      if (pinned.has(key)) {
        // Explicit values win unless they break a canon warning; then correct and say why.
        if (current === undefined || (current >= c.lint.lo - 1e-6 && current <= c.lint.hi + 1e-6))
          continue
        set(key, id, patchFor(node, path, c.value), c.value, {
          param: key,
          ruleId: c.ruleId,
          why: c.why,
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

/**
 * Touching melee zones must match (within 0.1 mm) or step clearly (0.4 mm+): move the row to
 * the halo size if it fits the band, else the halo to the row size (09 §1 "Melee zones").
 */
function settleMeleeZones(
  d: Design,
  pinned: Set<RecipeParam>,
  values: Suggestion['values'],
  notes: Map<RecipeParam, Suggestion['notes'][number]>,
): Design {
  const halo = d.nodes.halo
  const row = d.nodes.row
  const clash = MEASURES.meleeStep?.({ design: d, facts: {} })?.value === 1
  if (!clash || halo?.kind !== 'halo' || row?.kind !== 'gemRow') return d
  const rule = RULES_BY_ID.get('rows.walledPave')!
  const facts = nodeFacts(d, 'row')
  const fits = halo.stoneWidth <= (lintRange(rule, facts)?.hi ?? 0) + 1e-9
  const why = RULES_BY_ID.get('halo.meleeZones')!.rationale
  if (!pinned.has('row.stoneWidth') && fits) {
    values['row.stoneWidth'] = halo.stoneWidth
    notes.set('row.stoneWidth', { param: 'row.stoneWidth', ruleId: 'halo.meleeZones', why })
    return patchNode(d, 'row', { stoneWidth: halo.stoneWidth })
  }
  if (!pinned.has('halo.stoneWidth')) {
    values['halo.stoneWidth'] = row.stoneWidth
    notes.set('halo.stoneWidth', { param: 'halo.stoneWidth', ruleId: 'halo.meleeZones', why })
    return patchNode(d, 'halo', { stoneWidth: row.stoneWidth })
  }
  return d
}

/** The canon's suggestion for a spec: values by recipe param and why each was chosen. */
export function suggestParameters(spec: PieceSpecInput, o: { variant?: Variant } = {}): Suggestion {
  const { values, notes } = suggestDesign(spec, o)
  return { values, notes }
}

/**
 * The recipe hook: canon values for everything the spec leaves open. Corrections to explicit
 * spec fields are left out, because the recipe lets explicit fields win; the assistant offers
 * them from `suggestParameters(...).notes` instead.
 */
export const canonDefaults: RecipeDefaults = (spec) => {
  const { values, notes } = suggestParameters(spec)
  const corrected = new Set(notes.filter((n) => n.asked !== undefined).map((n) => n.param))
  return Object.fromEntries(
    Object.entries(values).filter(([k]) => !corrected.has(k as RecipeParam)),
  )
}
