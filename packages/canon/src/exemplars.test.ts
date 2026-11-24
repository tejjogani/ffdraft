import { ARCHETYPES, applyOps, validateDesign } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { matchStyles } from './engine'
import { buildExemplar, EXEMPLAR_SOURCES, getExemplars } from './exemplars/index'
import { lintDesign } from './lint'
import { DesignReadSchema, ExemplarSourceSchema } from './model'
import { RULES_BY_ID } from './rules/index'
import { STYLES } from './styles/index'

const PLANNED: Record<string, number> = {
  solitaire: 6,
  halo: 4,
  threeStone: 4,
  eternity: 3,
  band: 4,
  signet: 4,
  pendantSolitaire: 3,
  namePendant: 3,
  icedPendant: 6,
  medallion: 2,
  studs: 3,
  tennis: 3,
  cuban: 2,
  custom: 3,
}

describe('exemplars', () => {
  it('are 50, valid, uniquely named and in the planned mix', () => {
    expect(EXEMPLAR_SOURCES).toHaveLength(50)
    for (const e of EXEMPLAR_SOURCES)
      expect(() => ExemplarSourceSchema.parse(e), e.id).not.toThrow()
    expect(new Set(EXEMPLAR_SOURCES.map((e) => e.id)).size).toBe(50)
    const counts: Record<string, number> = {}
    for (const e of EXEMPLAR_SOURCES) counts[e.archetype] = (counts[e.archetype] ?? 0) + 1
    expect(counts).toEqual(PLANNED)
    for (const a of ARCHETYPES) expect(counts[a], a).toBeGreaterThan(0)
  })

  it('cover every style guide', () => {
    const covered = new Set(EXEMPLAR_SOURCES.flatMap((e) => matchStyles(e.styles).map((g) => g.id)))
    for (const g of STYLES) expect(covered.has(g.id), g.id).toBe(true)
  })

  for (const e of EXEMPLAR_SOURCES)
    it(`${e.id} builds, validates and is lint-clean; its anti-twin trips exactly ${e.antiTwin.ruleId}`, () => {
      const design = buildExemplar(e)
      expect(design.kind).toBe(e.kind)
      expect(validateDesign(design).filter((i) => i.level === 'error')).toEqual([])
      const o = { archetype: e.archetype, styles: e.styles }
      expect(lintDesign(design, undefined, o).map((f) => f.message)).toEqual([])
      expect(RULES_BY_ID.has(e.antiTwin.ruleId)).toBe(true)
      const twin = applyOps(design, e.antiTwin.ops).design
      expect([...new Set(lintDesign(twin, undefined, o).map((f) => f.ruleId))]).toEqual([
        e.antiTwin.ruleId,
      ])
    })

  it('read as their declared variant, with a valid design read', () => {
    for (const e of getExemplars()) {
      expect(() => DesignReadSchema.parse(e.read), e.id).not.toThrow()
      expect(e.read.variant, e.id).toBe(e.variant)
      expect(e.read.archetype).toBe(e.archetype)
      expect(Object.keys(e.keyParams).length, e.id).toBeGreaterThan(2)
    }
  })

  it('are deterministic', () => {
    for (const e of EXEMPLAR_SOURCES.slice(0, 10))
      expect(buildExemplar(e)).toEqual(buildExemplar(e))
  })
})
