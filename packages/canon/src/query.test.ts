import { describe, expect, it } from 'vitest'
import { getExemplars } from './exemplars/index'
import { CANON_INDEX, renderCanonForPrompt, UNIVERSAL_PRINCIPLES } from './prompt'
import type { CanonQuery } from './query'
import { canonFor } from './query'

const tokens = (s: string) => Math.ceil(s.length / 4)
const us = (value: number) => ({ system: 'us' as const, value })

/** Twelve-plus varied briefs, each with rules and a style guide it must surface. */
const QUERIES: {
  name: string
  q: CanonQuery
  rules: string[]
  style?: string
  archetype?: string
}[] = [
  {
    name: '1 ct round solitaire',
    q: { archetype: 'solitaire', centre: { cut: 'round', widthMm: 6.5 }, ringSize: us(6) },
    rules: ['ring.solitaire.bandWidth', 'ring.head.prongWire', 'ring.solitaire.elevation'],
  },
  {
    name: 'dainty oval',
    q: {
      archetype: 'solitaire',
      centre: { cut: 'oval', widthMm: 5 },
      styles: ['delicate'],
      variant: 'delicate',
    },
    rules: ['ring.solitaire.bandWidth'],
  },
  {
    name: 'cushion halo',
    q: { archetype: 'halo', centre: { cut: 'cushion', widthMm: 6.2 }, ringSize: us(6) },
    rules: ['halo.melee', 'halo.offset', 'halo.outline'],
  },
  {
    name: 'Art Deco emerald three-stone',
    q: { archetype: 'threeStone', centre: { cut: 'emerald', widthMm: 6 }, styles: ['art deco'] },
    rules: ['threeStone.tableDrop'],
    style: 'artDeco',
  },
  {
    name: 'full eternity',
    q: { archetype: 'eternity', ringSize: us(6) },
    rules: ['rows.walledPave', 'rows.eternityBase'],
  },
  {
    name: "men's band",
    q: { archetype: 'band', styles: ["men's"], ringSize: us(10) },
    rules: ['band.mens.width', 'band.mens.thickness'],
  },
  {
    name: 'heritage signet',
    q: { archetype: 'signet', styles: ['heritage'], ringSize: us(9) },
    rules: ['signet.faceAcross', 'signet.plate'],
    style: 'heritageSignet',
  },
  {
    name: 'solitaire pendant',
    q: {
      archetype: 'pendantSolitaire',
      centre: { cut: 'round', widthMm: 5.2 },
      styles: ['minimal'],
    },
    rules: ['bail.opening', 'pendant.head.wire', 'bail.solitaire'],
    style: 'minimal',
  },
  {
    name: 'iced initial',
    q: { archetype: 'icedPendant', heightMm: 32, styles: ['hip hop'] },
    rules: ['iced.thickness', 'iced.sizeMax', 'bail.opening'],
    style: 'icedOut',
  },
  {
    name: '70 mm iced logo',
    q: { archetype: 'icedPendant', heightMm: 70, styles: ['iced out'], variant: 'bold' },
    rules: ['iced.metalUnder', 'iced.edge'],
    style: 'icedOut',
  },
  {
    name: 'studs',
    q: { archetype: 'studs', centre: { cut: 'round', widthMm: 5.1 } },
    rules: ['pendant.head.wire', 'earring.post.wire'],
  },
  { name: 'tennis bracelet', q: { archetype: 'tennis' }, rules: ['chain.tennis.wire'] },
  {
    name: 'Cuban chain',
    q: { archetype: 'cuban', styles: ['hip hop'] },
    rules: ['chain.cuban.wire'],
    style: 'icedOut',
  },
  {
    name: 'vintage halo',
    q: { archetype: 'halo', centre: { cut: 'round', widthMm: 6.5 }, styles: ['vintage'] },
    rules: ['halo.melee'],
    style: 'vintageRevival',
  },
  {
    name: 'temple medallion',
    q: { archetype: 'medallion', heightMm: 30, styles: ['temple'] },
    rules: ['bail.opening'],
    style: 'temple',
  },
]

describe('canonFor', () => {
  for (const { name, q, rules, style } of QUERIES)
    it(`returns a focused slice for: ${name}`, () => {
      const s = canonFor(q)
      const ids = s.rules.map((r) => r.rule.id)
      for (const id of rules) expect(ids, id).toContain(id)
      expect(s.exemplars.length).toBeGreaterThanOrEqual(2)
      expect(s.exemplars.length).toBeLessThanOrEqual(4)
      const archetypes = new Set(getExemplars().map((e) => e.archetype))
      if (q.archetype && archetypes.has(q.archetype))
        expect(s.exemplars.map((e) => e.archetype)).toContain(q.archetype)
      if (style) expect(s.styles.map((g) => g.id)).toContain(style)
      expect(s.questions.length).toBeLessThanOrEqual(3)
      expect(tokens(renderCanonForPrompt(s))).toBeLessThanOrEqual(q.budgetTokens ?? 1500)
      expect(canonFor(q)).toEqual(s)
    })

  it('evaluates bands as numbers for the piece in hand', () => {
    const s = canonFor(QUERIES[0]!.q)
    const band = s.rules.find((r) => r.rule.id === 'ring.solitaire.bandWidth')!.band!
    expect(band.typical).toBeCloseTo(1.95)
  })

  it('honours a smaller budget and the exemplar count', () => {
    const s = canonFor({ ...QUERIES[2]!.q, budgetTokens: 900, exemplars: 2 })
    expect(s.exemplars).toHaveLength(2)
    expect(tokens(renderCanonForPrompt(s))).toBeLessThanOrEqual(900)
  })

  it('changes its key when the slice changes', () => {
    expect(canonFor(QUERIES[0]!.q).key).not.toBe(canonFor(QUERIES[2]!.q).key)
  })

  it('renders stable, compact prompt text', () => {
    expect(renderCanonForPrompt(canonFor(QUERIES[2]!.q))).toMatchSnapshot()
    expect(renderCanonForPrompt(canonFor(QUERIES[8]!.q))).toMatchSnapshot()
    expect(renderCanonForPrompt(canonFor(QUERIES[0]!.q), { format: 'index' })).toMatchSnapshot()
    expect(tokens(UNIVERSAL_PRINCIPLES)).toBeLessThan(600)
    expect(tokens(CANON_INDEX)).toBeLessThan(2500)
  })
})
