import { applyOps, buildDesign, type Design, type PieceSpecInput, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { lintDesign } from './lint'
import type { CanonFinding } from './model'
import { canonDefaults, suggestDesign, suggestParameters } from './suggest'

/**
 * Template values the canon corrects, with the rule that objects. These are data bugs in
 * TEMPLATES, recorded here until the templates are fixed in @pave/schema.
 */
const TEMPLATE_CORRECTIONS: Record<string, string[]> = {
  'oval-pave': ['row.stoneWidth'],
  eternity: ['row.stoneWidth'],
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

  it('gives the recipe hook only what the spec leaves open', () => {
    const oval = TEMPLATES.find((t) => t.id === 'oval-pave')!
    const full = suggestParameters(oval.spec)
    const hook = canonDefaults(oval.spec as never)
    expect(full.values['row.stoneWidth']).toBeLessThanOrEqual(1.0)
    expect(hook['row.stoneWidth']).toBeUndefined()
    expect(hook['head.prongDiameter']).toBe(full.values['head.prongDiameter'])
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

  it('flags a bail opening only 1.2 mm wider than an 8 mm chain, and the 1.5 mm minimum bail', () => {
    const spec: PieceSpecInput = {
      kind: 'pendant',
      archetype: 'icedPendant',
      title: 'test',
      summary: '',
      body: { heightMm: 50, text: 'A' },
      chain: { style: 'cuban', lengthMm: 559, widthMm: 8 },
    }
    const { design } = suggestDesign(spec)
    for (const opening of [9.2, 1.5]) {
      const bad = applyOps(design, [{ t: 'update', id: 'bail', patch: { opening } }]).design
      const f = expectFixed(bad, 'bail.opening', { spec })
      expect(f.fix!.ops[0]).toMatchObject({ patch: { opening: 9.5 } })
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
