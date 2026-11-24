import {
  applyOps,
  buildDesign,
  type Design,
  type PieceSpecInput,
  PieceSpecSchema,
  TEMPLATES,
} from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { lintDesign } from './lint'
import type { CanonFinding } from './model'
import { canonDefaults, suggestDesign, suggestParameters } from './suggest'

/**
 * Template values the canon corrects, with the rule that objects. These are data bugs in
 * TEMPLATES, recorded here until the templates are fixed in @pave/schema.
 */
const TEMPLATE_CORRECTIONS: Record<string, string[]> = {
  'iced-trophy': ['ice.sizeMax'],
  'iced-initial': ['ice.sizeMax'],
}

describe('suggestParameters', () => {
  for (const t of TEMPLATES)
    it(`makes the ${t.id} template lint-clean`, () => {
      const { design, notes } = suggestDesign(t.spec)
      expect(lintDesign(design, undefined, { spec: t.spec }).map((f) => f.message)).toEqual([])
      const corrected = notes.filter((n) => n.asked !== undefined).map((n) => n.param)
      expect(corrected).toEqual(TEMPLATE_CORRECTIONS[t.id] ?? [])
    })

  it('leaves explicit spec values alone when they are inside the canon', () => {
    const tennis = TEMPLATES.find((t) => t.id === 'tennis')!
    const { values } = suggestParameters(tennis.spec)
    expect(values['chain.linkWidth']).toBeUndefined()
    expect(values['chain.length']).toBeUndefined()
  })

  it('gives the recipe hook values computed for the design the recipe builds', () => {
    const oval = TEMPLATES.find((t) => t.id === 'oval-pave')!
    const hook = canonDefaults(PieceSpecSchema.parse(oval.spec))
    expect(hook['row.stoneWidth']).toBeUndefined()
    // 1.3 mm pavé was asked on a 1.8 mm band: too big for walled seats, right for shared claws.
    expect(hook['row.setting']).toBe('sharedProng')
  })

  for (const t of TEMPLATES)
    it(`gives the same hook values for the raw and the parsed ${t.id} spec`, () => {
      const parsed = PieceSpecSchema.parse(t.spec)
      expect(canonDefaults(parsed)).toEqual(canonDefaults(t.spec as never))
      // Pinned values held as given: the only findings are the ones the canon would correct.
      const corrected = new Set(
        suggestParameters(parsed).notes.flatMap((n) => (n.asked === undefined ? [] : [n.ruleId])),
      )
      const { design } = suggestDesign(parsed, { correct: false })
      for (const f of lintDesign(design, undefined, { spec: parsed }))
        expect(corrected, f.message).toContain(f.ruleId)
    })

  it('explains every value with a rule and is deterministic', () => {
    const spec = TEMPLATES.find((t) => t.id === 'halo')!.spec
    const a = suggestParameters(spec)
    expect(a).toEqual(suggestParameters(spec))
    for (const n of a.notes) expect(n.why.length, n.param).toBeGreaterThan(10)
  })

  it('follows the variant', () => {
    const spec = TEMPLATES.find((t) => t.id === 'solitaire')!.spec
    const delicate = suggestParameters(spec, { variant: 'delicate' }).values['band.widthTop']
    const bold = suggestParameters(spec, { variant: 'bold' }).values['band.widthTop']
    expect(delicate).toBeLessThan(bold as number)
  })
})

const ring = (
  stones: PieceSpecInput['stones'],
  ring: PieceSpecInput['ring'] = { size: { system: 'us', value: 6 } },
): PieceSpecInput => ({
  kind: 'ring',
  archetype: 'solitaire',
  title: 'test',
  summary: '',
  ring,
  stones,
})

/** Lints, asserts the expected finding carries a fix, applies it and checks the finding is gone. */
function expectFixed(
  design: Design,
  ruleId: string,
  o: Parameters<typeof lintDesign>[2],
): CanonFinding {
  const finding = lintDesign(design, undefined, o).find((f) => f.ruleId === ruleId)
  expect(finding, ruleId).toBeDefined()
  expect(finding!.code).toBe(`style.${ruleId}`)
  expect(finding!.fix, ruleId).toBeDefined()
  const fixed = applyOps(design, finding!.fix!.ops).design
  expect(lintDesign(fixed, undefined, o).map((f) => f.ruleId)).not.toContain(ruleId)
  return finding!
}

describe('lintDesign on bad designs', () => {
  it('flags a 3 mm melee halo on a 5 mm centre', () => {
    const spec = {
      ...ring([
        { role: 'center', widthMm: 5 },
        { role: 'halo', widthMm: 3 },
      ]),
      archetype: 'halo' as const,
    }
    const d = buildDesign(spec)
    const f = expectFixed(d, 'halo.melee', { spec })
    expect(f.fix!.ops[0]).toMatchObject({ id: 'halo', patch: { stoneWidth: 1.25 } })
    expect(lintDesign(d, undefined, { spec }).map((x) => x.ruleId)).toContain('halo.outline')
  })

  it('flags a 6 mm band under a 4 mm stone', () => {
    const spec = ring([{ role: 'center', widthMm: 4 }], {
      size: { system: 'us', value: 6 },
      bandWidthMm: 6,
    })
    const f = expectFixed(buildDesign(spec), 'ring.solitaire.bandWidth', { spec })
    expect(f.value).toBe(6)
    expect(f.limit).toBeCloseTo(2.6)
  })

  it('flags a bail whose hole cannot pass an 8 mm Cuban, and the 1.5 mm minimum bail', () => {
    const spec: PieceSpecInput = {
      kind: 'pendant',
      archetype: 'icedPendant',
      title: 'test',
      summary: '',
      body: { heightMm: 50, text: 'A' },
      chain: { style: 'cuban', lengthMm: 559, widthMm: 8 },
    }
    const { design } = suggestDesign(spec)
    // Behind a flooded front, a hidden bail whose slot passes the 8 × 4 mm section with 1.5 mm
    // to spare: 1.15·8 + 2.0.
    expect(design.nodes.bail).toMatchObject({ style: 'hidden' })
    for (const opening of [9.5, 1.5]) {
      const bad = applyOps(design, [{ t: 'update', id: 'bail', patch: { opening } }]).design
      const f = expectFixed(bad, 'bail.opening', { spec })
      expect(f.limit).toBeCloseTo(11.2)
      expect(f.fix!.ops[0]).toMatchObject({ patch: { opening: expect.any(Number) } })
      expect(f.value).toBeLessThan(f.limit)
    }
  })

  it('flags a paper-thin iced pendant', () => {
    const spec = TEMPLATES.find((t) => t.id === 'iced-initial')!.spec
    const { design } = suggestDesign(spec)
    const thin = applyOps(design, [{ t: 'update', id: 'body', patch: { thickness: 1.2 } }]).design
    const ids = lintDesign(thin, undefined, { spec }).map((f) => f.ruleId)
    expect(ids).toContain('iced.metalUnder')
    expectFixed(thin, 'iced.thickness', { spec })
  })

  it('honours waivers', () => {
    const spec = ring([{ role: 'center', widthMm: 4 }], {
      size: { system: 'us', value: 6 },
      bandWidthMm: 6,
    })
    const ids = lintDesign(buildDesign(spec), undefined, {
      spec,
      waived: ['ring.solitaire.bandWidth'],
    }).map((f) => f.ruleId)
    expect(ids).not.toContain('ring.solitaire.bandWidth')
  })
})

const band = (style: string[], size = 6): PieceSpecInput => ({
  kind: 'ring',
  archetype: 'band',
  title: 'test',
  summary: '',
  style,
  ring: { size: { system: 'us', value: size } },
})

describe('brief words', () => {
  it("never read ordinary words as a men's brief, a variant or a style guide", () => {
    const plain = suggestParameters(band([])).values
    for (const word of ["women's", 'engagement', 'statement', 'ornamental', 'gentle'])
      expect(suggestParameters(band([word])).values, word).toEqual(plain)
    const sol = TEMPLATES.find((t) => t.id === 'solitaire')!.spec
    const base = suggestParameters({ ...sol, style: [] }).values
    for (const word of ['fine jewelry', 'refined', 'decorative', 'signature', 'cocktail', 'modern'])
      expect(suggestParameters({ ...sol, style: [word] }).values, word).toEqual(base)
  })

  it("reads men's, gents and masculine as a men's brief", () => {
    const plain = suggestParameters(band([], 10)).values['band.widthTop'] as number
    for (const word of ["men's", 'mens', 'gents', 'masculine'])
      expect(suggestParameters(band([word], 10)).values['band.widthTop'], word).toBeGreaterThan(
        plain + 2,
      )
  })
})

describe('style recipes stay inside the archetype', () => {
  it("keep a men's band a men's band under minimal or Art Deco", () => {
    const mens = suggestParameters(band(["men's"], 10)).values['band.widthTop'] as number
    for (const style of ['minimal', 'art deco', 'victorian', 'retro', 'maximalist'])
      expect(suggestParameters(band(["men's", style], 10)).values['band.widthTop'], style).toBe(
        mens,
      )
  })

  it('keep a signet tapering under minimal', () => {
    const signet = TEMPLATES.find((t) => t.id === 'signet')!.spec
    const { values } = suggestParameters({ ...signet, style: ['minimal'] })
    const top = (values['band.widthTop'] ?? 0) as number
    expect(top).toBeGreaterThan(values['band.widthBottom'] as number)
  })

  it('give the Retro and Maximalist wide bands only to a big centre', () => {
    for (const style of ['retro', 'maximalist']) {
      const small = suggestParameters(ring([{ role: 'center', carat: 1 }]) as never)
      const styled = suggestParameters({ ...ring([{ role: 'center', carat: 1 }]), style: [style] })
      expect(styled.values['band.widthTop'], style).toBe(small.values['band.widthTop'])
      const big = suggestParameters({ ...ring([{ role: 'center', widthMm: 11 }]), style: [style] })
      expect(big.values['band.widthTop'] as number, style).toBeGreaterThanOrEqual(4)
      expect(big.values['band.widthBottom'] as number, style).toBeGreaterThanOrEqual(2.5)
    }
  })
})

describe('rule precedence', () => {
  it('sets an east-west stone low, in a basket', () => {
    const spec = { ...ring([{ role: 'center', cut: 'oval' as const, carat: 1 }]), style: ['east-west'] }
    const { values, notes } = suggestParameters(spec)
    expect(values['head.style']).toBe('basket')
    expect(values['center.elevation'] as number).toBeLessThanOrEqual(1.2)
    expect(notes.find((n) => n.param === 'center.elevation')?.ruleId).toBe('eastWest.low')
  })

  it('takes a cathedral its own typical height, and says so', () => {
    const spec = ring([{ role: 'center', carat: 1 }], {
      size: { system: 'us', value: 6 },
      shoulder: 'cathedral',
    })
    const { values, notes } = suggestParameters(spec)
    const t = values['band.thicknessTop'] as number
    expect(values['center.elevation'] as number).toBeCloseTo(t + 1.2, 1)
    expect(notes.find((n) => n.param === 'center.elevation')?.ruleId).toBe(
      'ring.cathedral.elevation',
    )
  })

  it('turns claws onto symmetric positions for every count', () => {
    for (const prongs of [3, 4, 5, 6, 8]) {
      const spec = ring([{ role: 'center', widthMm: 7, prongs }])
      const { design } = suggestDesign(spec)
      expect(
        lintDesign(design, undefined, { spec }).map((f) => f.ruleId),
        String(prongs),
      ).not.toContain('ring.head.clawSymmetry')
    }
  })
})

const eternity = (o: { stone?: number; band?: number } = {}): PieceSpecInput => ({
  kind: 'ring',
  archetype: 'eternity',
  title: 'test',
  summary: '',
  metal: { alloy: 'pt950' },
  ring: { size: { system: 'us', value: 6 }, ...(o.band ? { bandWidthMm: o.band } : {}) },
  stones: o.stone ? [{ role: 'accent', widthMm: o.stone, setting: 'pave' }] : [],
})

describe('eternity rows', () => {
  it('builds one row from the variant scale, with the band to fit, in each variant', () => {
    const want = { delicate: [1.3, 1.5], classic: [1.8, 2.2], bold: [2.7, 3.0] } as const
    for (const variant of ['delicate', 'classic', 'bold'] as const) {
      const { values, design } = suggestDesign(eternity(), { variant })
      const d = values['row.stoneWidth'] as number
      expect(values['row.rows'] ?? 1, variant).toBe(1)
      expect(d).toBeGreaterThanOrEqual(want[variant][0])
      expect(d).toBeLessThanOrEqual(want[variant][1])
      expect(values['band.widthTop']).toBeCloseTo(d + 1.0, 5)
      expect(lintDesign(design, undefined, { spec: eternity() })).toEqual([])
    }
  })

  it('widens an open band to a chosen stone, in one row', () => {
    for (const stone of [2, 3]) {
      const { values, notes } = suggestParameters(eternity({ stone }))
      expect(values['row.rows'] ?? 1).toBe(1)
      expect(values['band.widthTop']).toBeCloseTo(stone + 1.0, 5)
      expect(notes.filter((n) => n.asked !== undefined)).toEqual([])
    }
  })

  it('puts one row of 2 mm stones on a 3 mm band', () => {
    const { values, design } = suggestDesign(eternity({ band: 3 }))
    expect(values['row.rows'] ?? 1).toBe(1)
    expect(values['row.stoneWidth']).toBe(2)
    expect(lintDesign(design, undefined, { spec: eternity({ band: 3 }) })).toEqual([])
  })
})

const haloSpec = (W: number, style: string[] = []): PieceSpecInput => ({
  kind: 'ring',
  archetype: 'halo',
  title: 'test',
  summary: '',
  style,
  ring: { size: { system: 'us', value: 6 } },
  stones: [
    { role: 'center', widthMm: W },
    { role: 'accent', setting: 'pave' },
  ],
})

describe('halo with pavé shoulders', () => {
  for (const W of [5, 6.5, 8, 10])
    it(`sizes the halo from a ${W} mm centre and stays lint-clean`, () => {
      // A 10 mm centre in a halo is a maximalist head (wider than 0.8 of the finger otherwise).
      const spec = haloSpec(W, W >= 10 ? ['maximalist'] : [])
      const { values, design } = suggestDesign(spec)
      const typical = Math.min(1.7, Math.max(1, 0.1 * W + 0.6))
      expect(Math.abs((values['halo.stoneWidth'] as number) - typical)).toBeLessThanOrEqual(0.1)
      expect(lintDesign(design, undefined, { spec })).toEqual([])
    })

  it('steps the row down when the band is pinned', () => {
    const spec = { ...haloSpec(6.5), ring: { size: { system: 'us' as const, value: 6 }, bandWidthMm: 1.9 } }
    const { values, design } = suggestDesign(spec)
    const step = (values['halo.stoneWidth'] as number) - (values['row.stoneWidth'] as number)
    expect(step <= 0.1 || step >= 0.4 - 1e-9).toBe(true)
    expect(lintDesign(design, undefined, { spec })).toEqual([])
  })
})

describe('pinned values', () => {
  it('move to the nearest value the canon allows, not its typical', () => {
    const spec = ring([{ role: 'center', carat: 1 }], { size: { system: 'us', value: 6 }, bandWidthMm: 4 })
    const { values, notes } = suggestParameters(spec)
    const note = notes.find((n) => n.param === 'band.widthTop')!
    expect(note.asked).toBe(4)
    expect(values['band.widthTop']).toBeCloseTo(2.9, 1)
  })
})
