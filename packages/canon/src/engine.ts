/**
 * Shared machinery for lint, suggest and query: which rules apply to a piece, how a style guide
 * overrides them, and what their bands evaluate to for a set of facts.
 */
import type { Archetype, PieceKind } from '@pave/schema'
import { and, type Expr, evalExpr, lt } from './expr'
import type { Facts } from './facts'
import type { Band, Rule, StyleGuide, Variant } from './model'
import { RULES } from './rules/index'
import { STYLES } from './styles/index'
import { hasAny, hasPhrase } from './words'

/**
 * Style guides named by the brief's style words (PieceSpec.style or an intent's tags), matched
 * as whole words or phrases, best match first: a guide named by its own label beats one reached
 * through an alias, then more matching words, then canon order.
 */
export function matchStyles(words: readonly string[] = []): StyleGuide[] {
  const scored = STYLES.map((g, i) => {
    const byName = hasAny(words, [g.label, g.id])
    const hits = g.aliases.filter((a) => hasPhrase(words, a)).length
    return { g, i, score: (byName ? 10 : 0) + hits }
  }).filter((x) => x.score > 0)
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return scored.map((x) => x.g)
}

/**
 * The rules with every matched style guide's overrides applied; an override band replaces
 * lintAt. A conditional override splits the rule in two with the same id: the style's version
 * where its `when` holds, the canon's elsewhere.
 */
export function effectiveRules(styles: readonly StyleGuide[]): Rule[] {
  const overrides = new Map(
    styles.flatMap((g) => (g.overrides ?? []).map((o) => [o.ruleId, o] as const)),
  )
  return RULES.flatMap((r) => {
    const o = overrides.get(r.id)
    if (!o) return [r]
    const { lintAt, ...rest } = r
    const styled: Rule = {
      ...rest,
      ...(o.band ? { band: o.band, variants: undefined } : lintAt ? { lintAt } : {}),
      ...(o.severity ? { severity: o.severity } : {}),
    }
    if (!o.when) return [styled]
    const within = (c: Expr): Rule['applies'] => ({
      ...r.applies,
      when: r.applies.when === undefined ? c : and(r.applies.when, c),
    })
    return [
      { ...styled, applies: within(o.when) },
      { ...r, applies: within(lt(o.when, 0.5)) },
    ]
  })
}

export interface PieceContext {
  kind: PieceKind
  archetype: Archetype
  words: readonly string[]
}

/** Piece-level applicability: kinds, archetypes and style words. `when` is checked per subject. */
export function ruleApplies(r: Rule, c: PieceContext): boolean {
  const a = r.applies
  if (a.kinds && !a.kinds.includes(c.kind)) return false
  if (a.archetypes && !a.archetypes.includes(c.archetype)) return false
  if (a.styles && !hasAny(c.words, a.styles)) return false
  return true
}

/** Whether `when` holds; an unknown fact means the rule does not apply. */
export const whenHolds = (r: Rule, f: Facts): boolean =>
  r.applies.when === undefined || (evalExpr(r.applies.when, f) ?? 0) !== 0

export interface Evaluated {
  typical: number
  min: number
  max: number
}

const evalB = (b: Band, f: Facts): Evaluated | undefined => {
  const typical = evalExpr(b.typical, f)
  const min = evalExpr(b.min, f)
  const max = evalExpr(b.max, f)
  return typical === undefined || min === undefined || max === undefined
    ? undefined
    : { typical, min, max }
}

/** The band for a variant (or the rule's own band), evaluated. */
export const bandFor = (r: Rule, f: Facts, variant?: Variant): Evaluated | undefined =>
  evalB((variant && r.variants?.[variant]) || r.band, f)

/** The widest band across the rule and its variants: what a design may sit anywhere inside. */
export function hullFor(r: Rule, f: Facts): Evaluated | undefined {
  const all = [r.band, ...Object.values(r.variants ?? {})].map((b) => evalB(b, f))
  const base = all[0]
  if (!base) return undefined
  let { min, max } = base
  for (const b of all) {
    if (!b) continue
    min = Math.min(min, b.min)
    max = Math.max(max, b.max)
  }
  return { typical: base.typical, min, max }
}

/** Lint thresholds: lintAt's sides when given (a missing side never lints), else the hull. */
export function lintRange(r: Rule, f: Facts): { lo: number; hi: number } | undefined {
  const at = (e: Expr | undefined, fallback: number) =>
    e === undefined ? fallback : evalExpr(e, f)
  if (r.lintAt) {
    const lo = at(r.lintAt.below, -Infinity)
    const hi = at(r.lintAt.above, Infinity)
    return lo === undefined || hi === undefined ? undefined : { lo, hi }
  }
  const h = hullFor(r, f)
  return h && { lo: h.min, hi: h.max }
}

const varsIn = (e: Expr | undefined, out = new Set<string>()): Set<string> => {
  if (e === undefined || typeof e === 'number') return out
  if ('var' in e) out.add(e.var)
  else for (const a of e.args) varsIn(a, out)
  return out
}

/**
 * How narrowly a rule targets: more filters and conditions win when bands disagree, and a rule
 * that declares what it refines always outranks the rule it refines.
 */
export const specificity = (r: Rule): number =>
  (r.refines ? 20 : 0) +
  (r.applies.archetypes ? 2 : 0) +
  (r.applies.styles ? 3 : 0) +
  (r.applies.kinds ? 1 : 0) +
  varsIn(r.applies.when).size
