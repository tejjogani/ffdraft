/**
 * Shared machinery for lint, suggest and query: which rules apply to a piece, how a style guide
 * overrides them, and what their bands evaluate to for a set of facts.
 */
import type { Archetype, PieceKind } from '@pave/schema'
import { type Expr, evalExpr } from './expr'
import type { Facts } from './facts'
import type { Band, Rule, StyleGuide, Variant } from './model'
import { RULES } from './rules/index'
import { STYLES } from './styles/index'

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Style guides named by the brief's style words (PieceSpec.style or an intent's tags). */
export function matchStyles(words: readonly string[] = []): StyleGuide[] {
  const w = words.map(norm)
  return STYLES.filter((g) =>
    [g.id, g.label, ...g.aliases].map(norm).some((a) => w.some((x) => x === a || x.includes(a))),
  )
}

/** The rules with every matched style guide's overrides applied; an override band replaces lintAt. */
export function effectiveRules(styles: readonly StyleGuide[]): Rule[] {
  const overrides = new Map(
    styles.flatMap((g) => (g.overrides ?? []).map((o) => [o.ruleId, o] as const)),
  )
  return RULES.map((r) => {
    const o = overrides.get(r.id)
    if (!o) return r
    const { lintAt, ...rest } = r
    return {
      ...rest,
      ...(o.band ? { band: o.band, variants: undefined } : lintAt ? { lintAt } : {}),
      ...(o.severity ? { severity: o.severity } : {}),
    }
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
  if (a.styles && !a.styles.some((s) => c.words.some((w) => norm(w).includes(norm(s)))))
    return false
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

/** How narrowly a rule targets: more filters and conditions win when bands disagree. */
export const specificity = (r: Rule): number =>
  (r.applies.archetypes ? 2 : 0) +
  (r.applies.styles ? 3 : 0) +
  (r.applies.kinds ? 1 : 0) +
  varsIn(r.applies.when).size
