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

describe('canonFor retrieval', () => {
  const ids = (q: CanonQuery) => canonFor(q).rules.map((r) => r.rule.id)

  it('builds the reference from the setting, shoulders, accent and chain it is given', () => {
    const bezel = ids({
      archetype: 'solitaire',
      centre: { cut: 'oval', widthMm: 6, setting: 'bezel' },
      styles: ['minimal', 'east-west'],
    })
    expect(bezel).toContain('bezel.wall')
    expect(bezel).not.toContain('ring.head.prongWire')
    const halo = ids({ archetype: 'halo', centre: { cut: 'cushion', widthMm: 6.2 }, accent: true })
    expect(halo.some((id) => id.startsWith('rows.'))).toBe(true)
    expect(
      ids({ archetype: 'medallion', heightMm: 40, chain: { style: 'figaro', widthMm: 4 } }),
    ).toContain('chain.figaroLoad')
    expect(
      ids({
        archetype: 'signet',
        styles: ["men's"],
        centre: { cut: 'round', widthMm: 3, stone: 'sapphire-blue', setting: 'flush' },
      }),
    ).toContain('signet.flushStone')
  })

  it('keeps an archetype’s own rules, as formulas, when the reference has nothing to evaluate', () => {
    const toi = canonFor({
      kind: 'ring',
      archetype: 'custom',
      styles: ['toi et moi'],
      centre: { cut: 'pear', widthMm: 6 },
    })
    expect(toi.rules.map((r) => r.rule.id)).toEqual(expect.arrayContaining(['toiEtMoi.balance']))
    const bangle = canonFor({ kind: 'bracelet', archetype: 'custom' })
    expect(bangle.rules.map((r) => r.rule.id)).toEqual(
      expect.arrayContaining(['bangle.size', 'bangle.wire']),
    )
  })

  it('ranks caveats by relevance and prints each once', () => {
    const s = canonFor({ archetype: 'icedPendant', heightMm: 60, styles: ['iced out'] })
    const scoops = s.caveats.filter((c) => /scoop/i.test(c.feature))
    expect(scoops).toHaveLength(1)
    expect(s.caveats[0]!.feature).not.toBe('Antique and fancy cuts')
  })

  it('never throws on out-of-range or mismatched queries', () => {
    const odd: CanonQuery[] = [
      { archetype: 'icedPendant', styles: ['x'.repeat(60)] },
      { archetype: 'icedPendant', styles: Array.from({ length: 13 }, (_, i) => `word${i}`) },
      { archetype: 'medallion', heightMm: 110 },
      { archetype: 'icedPendant', heightMm: 160 },
      { archetype: 'solitaire', centre: { cut: 'round', widthMm: 60 } },
      { archetype: 'icedPendant', heightMm: 2.5 },
    ]
    for (const q of odd) expect(() => canonFor(q), JSON.stringify(q).slice(0, 60)).not.toThrow()
    const mismatch = canonFor({ kind: 'pendant', archetype: 'solitaire' })
    expect(mismatch.questions.some((x) => x.startsWith('Ring size'))).toBe(false)
    expect(mismatch.rules.map((r) => r.rule.id)).not.toContain('iced.flatBack')
  })
})

describe('canonFor exemplars', () => {
  it('returns only exemplars of the archetype, or of the kind for custom pieces', () => {
    const cases: CanonQuery[] = [
      { archetype: 'signet', centre: { cut: 'cushion', widthMm: 10 } },
      { archetype: 'cuban' },
      { archetype: 'medallion' },
      { archetype: 'halo', styles: ['hip hop'] },
      { kind: 'earrings', archetype: 'custom' },
      { kind: 'pendant', archetype: 'custom' },
      { archetype: 'band', styles: ["men's"] },
    ]
    for (const q of cases) {
      const s = canonFor(q)
      for (const e of s.exemplars) {
        const ex = getExemplars().find((x) => x.id === e.id)!
        const ok = q.archetype === 'custom' ? ex.kind === q.kind : ex.archetype === q.archetype
        expect(ok, `${JSON.stringify(q)} → ${e.id}`).toBe(true)
      }
    }
  })

  it("puts the men's band first for a men's brief and the bold-tier piece first for a big iced one", () => {
    expect(canonFor({ archetype: 'band', styles: ["men's"] }).exemplars[0]!.id).toMatch(/mens/)
    const big = canonFor({ archetype: 'icedPendant', heightMm: 80, variant: 'bold' })
    expect(big.exemplars[0]!.id).toBe('iced-two-tone-star')
  })
})

describe('canonFor budget', () => {
  it('keeps a halo’s own rules under pressure', () => {
    const s = canonFor({ ...QUERIES[2]!.q, budgetTokens: 900 })
    const ids = s.rules.map((r) => r.rule.id)
    for (const id of ['halo.melee', 'halo.offset', 'halo.outline']) expect(ids).toContain(id)
    expect(tokens(renderCanonForPrompt(s))).toBeLessThanOrEqual(900)
  })

  it('stays within budget with many style words, or says it cannot', () => {
    for (const budgetTokens of [1500, 600, 300]) {
      const s = canonFor({
        archetype: 'halo',
        centre: { cut: 'round', widthMm: 6.5 },
        styles: ['vintage', 'art deco', 'celestial', 'iced out'],
        budgetTokens,
      })
      expect(s.styles.length).toBeLessThanOrEqual(2)
      if (!s.overBudget) expect(tokens(renderCanonForPrompt(s))).toBeLessThanOrEqual(budgetTokens)
    }
  })

  it('keys the slice on its rendered content and the canon version', () => {
    const a = canonFor(QUERIES[0]!.q)
    const b = canonFor({ ...QUERIES[0]!.q, exemplars: 2 })
    expect(a.key).not.toBe(b.key)
    expect(renderCanonForPrompt(a)).toContain(a.version)
  })
})
