import { applyOps } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { CAVEATS } from './caveats'
import { contexts, evaluations } from './corpus.testkit'
import { lintDesign } from './lint'
import { MEASURES } from './measures'
import { CaveatSchema, RuleSchema, StyleGuideSchema } from './model'
import { fieldInfo, patchFor, readPath } from './paths'
import { RULE_FAMILIES, RULES } from './rules/index'
import { STYLES } from './styles/index'
import { RECIPE_PARAMS } from './suggest'

const EPS = 1e-6
const evals = evaluations()

describe('rules', () => {
  it('validate against the model and have unique ids', () => {
    for (const r of RULES) expect(() => RuleSchema.parse(r), r.id).not.toThrow()
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length)
  })

  it('cover the v1 families in roughly the planned numbers, with caveats kept apart', () => {
    const counts = Object.fromEntries(Object.entries(RULE_FAMILIES).map(([k, v]) => [k, v.length]))
    expect(RULES.length).toBeGreaterThanOrEqual(150)
    expect(counts.solitaire).toBeGreaterThanOrEqual(22)
    expect(counts.iced).toBeGreaterThanOrEqual(15)
    for (const [family, n] of Object.entries(counts)) expect(n, family).toBeGreaterThanOrEqual(4)
    for (const c of CAVEATS) expect(() => CaveatSchema.parse(c), c.id).not.toThrow()
    expect(new Set(CAVEATS.map((c) => c.id)).size).toBe(CAVEATS.length)
  })

  it('constrain only paths that exist in the node schema', () => {
    for (const r of RULES)
      for (const p of r.paths) expect(fieldInfo(p), `${r.id}: ${p}`).toBeDefined()
    for (const [k, p] of Object.entries(RECIPE_PARAMS)) expect(fieldInfo(p), k).toBeDefined()
    for (const g of STYLES)
      for (const rec of g.recipes) expect(fieldInfo(rec.path), `${g.id}: ${rec.path}`).toBeDefined()
  })

  it('name only implemented measures, and only single-path rules carry a fix', () => {
    for (const r of RULES) {
      if (r.measure) expect(MEASURES[r.measure], r.id).toBeTypeOf('function')
      if (r.fix) expect(!r.measure && r.paths.length === 1, r.id).toBe(true)
    }
  })

  it('keep every band inside the schema range wherever it applies', () => {
    for (const e of evals) {
      if (e.rule.measure) continue
      const info = fieldInfo(e.rule.paths[0]!)!
      if (info.minimum === undefined || info.maximum === undefined) continue
      for (const b of [e.band, ...e.variants]) {
        const where = `${e.rule.id} on ${e.item.id}`
        expect(b.min, where).toBeGreaterThanOrEqual(info.minimum - EPS)
        expect(b.max, where).toBeLessThanOrEqual(info.maximum + EPS)
      }
    }
  })

  it('keep the typical value inside its band and lint thresholds outside it', () => {
    for (const e of evals) {
      const where = `${e.rule.id} on ${e.item.id}`
      for (const b of [e.band, ...e.variants]) {
        expect(b.min, where).toBeLessThanOrEqual(b.max + EPS)
        expect(b.typical, where).toBeGreaterThanOrEqual(b.min - EPS)
        expect(b.typical, where).toBeLessThanOrEqual(b.max + EPS)
      }
      if (e.lint) {
        expect(e.lint.lo, where).toBeLessThanOrEqual(e.hull.min + EPS)
        expect(e.lint.hi, where).toBeGreaterThanOrEqual(e.hull.max - EPS)
      }
    }
  })

  it('are all evaluated by the corpus, and evaluate wherever they apply', () => {
    const seen = new Set(evals.map((e) => e.rule.id))
    expect(RULES.filter((r) => !seen.has(r.id)).map((r) => r.id)).toEqual([])
    expect(
      contexts()
        .filter((c) => 'undefinedBand' in c)
        .map((c) => `${c.rule.id} on ${c.item.id}`),
    ).toEqual([])
  })

  it('style guides validate and override only real rules', () => {
    const ids = new Set(RULES.map((r) => r.id))
    expect(STYLES).toHaveLength(17)
    for (const g of STYLES) {
      expect(() => StyleGuideSchema.parse(g), g.id).not.toThrow()
      for (const o of g.overrides ?? [])
        expect(ids.has(o.ruleId), `${g.id}: ${o.ruleId}`).toBe(true)
    }
  })
})

/**
 * Every lintable single-parameter rule, in the first corpus context where it applies: push the
 * parameter just past each threshold the schema can reach, expect the rule's finding, apply its
 * fix and expect the finding gone and no new warning on the design.
 */
describe('each lintable rule trips and its fix clears it', () => {
  const byRule = new Map<string, (typeof evals)[number][]>()
  for (const e of evals)
    if (
      e.node &&
      !e.rule.measure &&
      e.rule.severity !== 'default' &&
      e.rule.paths.length === 1 &&
      e.lint &&
      readPath(e.node, e.rule.paths[0]!) !== undefined
    )
      byRule.set(e.rule.id, [...(byRule.get(e.rule.id) ?? []), e])
  it('covers the lintable rules', () => expect(byRule.size).toBeGreaterThan(50))
  /** Tries one context; returns how many thresholds it could cross. */
  const attempt = (id: string, e: (typeof evals)[number]): number => {
    const path = e.rule.paths[0]!
    const info = fieldInfo(path)!
    const o = {
      archetype: e.item.archetype,
      styles: e.item.styles,
      ...(e.item.pairWith ? { pairWith: e.item.pairWith } : {}),
    }
    const step = info.type === 'integer' ? 1 : Math.max(0.05, info.step ?? 0.01)
    let tried = 0
    for (const past of [e.lint!.hi + step, e.lint!.lo - step]) {
      if (!Number.isFinite(past)) continue
      if (past < (info.minimum ?? -Infinity) || past > (info.maximum ?? Infinity)) continue
      const value = info.type === 'integer' ? Math.round(past) : Number(past.toFixed(4))
      const bad = applyOps(e.item.design, [
        { t: 'update', id: e.node!.id, patch: patchFor(e.node!, path, value) },
      ]).design
      const found = lintDesign(bad, undefined, o).find(
        (f) => f.ruleId === id && f.nodeId === e.node!.id,
      )
      // Moving one parameter can change the facts its own threshold reads (a band that sets
      // its own wall); a threshold that moves with the value cannot be crossed this way.
      if (!found) continue
      tried++
      if (!found.fix) continue
      const before = new Set(lintDesign(bad, undefined, o).map((f) => f.code))
      const fixed = applyOps(bad, found.fix.ops).design
      const after = lintDesign(fixed, undefined, o)
      expect(
        after.map((f) => f.ruleId),
        `${id} fix ${found.fix.label}`,
      ).not.toContain(id)
      const added = after.filter((f) => f.level === 'warning' && !before.has(f.code))
      expect(
        added.map((f) => f.message),
        `${id} fix ${found.fix.label}`,
      ).toEqual([])
    }
    return tried
  }
  for (const [id, list] of byRule)
    it(id, () => {
      // The first context where the schema range reaches past a threshold.
      let tried = 0
      for (const e of list) {
        tried += attempt(id, e)
        if (tried) break
      }
      expect(tried, `${id}: no threshold could be crossed`).toBeGreaterThan(0)
    })
})
