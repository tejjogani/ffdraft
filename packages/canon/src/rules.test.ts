import { describe, expect, it } from 'vitest'
import { evaluations } from './corpus.testkit'
import { MEASURES } from './measures'
import { RuleSchema, StyleGuideSchema } from './model'
import { fieldInfo } from './paths'
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

  it('cover the v1 families in roughly the planned numbers', () => {
    const counts = Object.fromEntries(Object.entries(RULE_FAMILIES).map(([k, v]) => [k, v.length]))
    expect(RULES.length).toBeGreaterThanOrEqual(150)
    expect(counts.solitaire).toBeGreaterThanOrEqual(22)
    expect(counts.iced).toBeGreaterThanOrEqual(15)
    for (const [family, n] of Object.entries(counts)) expect(n, family).toBeGreaterThanOrEqual(5)
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

  it('are exercised by the corpus', () => {
    const seen = new Set(evals.map((e) => e.rule.id))
    const live = RULES.filter((r) => r.expressible !== false)
    expect(seen.size / live.length).toBeGreaterThan(0.75)
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
