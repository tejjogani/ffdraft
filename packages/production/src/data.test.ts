import { METALS } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { billOfMaterials } from './bom'
import { createContext } from './context'
import { estimateCost } from './cost'
import { csvCell, encodeCsv, toCsv } from './csv'
import { bundleRoot, safeSegment, skuSlug, uniqueName } from './paths'
import { evaluationOf, fixtureKernel, stoneAt, templateDesign } from './testing/fixtures'
import { box } from './testing/shapes'
import type { BuildInput } from './types'

/** A 1000 mm³ Pt950 block with one 6.5 mm round diamond, priced with explicit rates. */
function input(
  overrides: Partial<BuildInput['options']> = {},
  design = templateDesign('solitaire'),
): BuildInput {
  const evaluation = evaluationOf(
    [{ id: 'band', name: 'Ring', material: 'pt950', mesh: box([0, 0, 0], [10, 10, 10]) }],
    [stoneAt('center:0', 'center', 6.5, [5, 5, 12])],
  )
  return {
    piece: { id: 'p', title: 'Test', kind: 'ring', sku: 'T-1' },
    revision: 1,
    design,
    evaluation,
    kernel: fixtureKernel(evaluation),
    fonts: {
      sans: { regular: new Uint8Array(), medium: new Uint8Array(), semibold: new Uint8Array() },
      serif: new Uint8Array(),
    },
    options: {
      quantity: 4,
      date: '2026-11-23',
      author: { name: 'A' },
      org: { name: 'O' },
      ...overrides,
    },
  }
}

describe('cost estimate', () => {
  const rates = {
    spotPerGram: { platinum: 50 },
    castingLossPct: 5,
    alloyPremiumPct: 10,
    stonePricePerCt: { diamond: 1000 },
    settingPerStone: { prong: 20 },
    cadFee: 100,
    printFee: 30,
    castingFee: 20,
    finishHours: 0.5,
    hourlyRate: 60,
    assayFee: 5,
    overheadPct: 10,
    marginPct: 50,
    taxPct: 20,
  }

  it('follows the research formula line by line', () => {
    const ctx = createContext(input({ rates }))
    const c = estimateCost(ctx)
    const line = (id: string) => c.lines.find((l) => l.id === id)!
    // 1000 mm³ → grams = density
    const g = METALS.pt950.density
    expect(line('metal:pt950').amount).toBeCloseTo(g * 1.05 * 50 * 0.95 * 1.1, 2)
    const ct = ctx.lots[0]!.lot.caratTotal
    expect(line('stones:S1').amount).toBeCloseTo(ct * 1000, 2)
    expect(line('setting:S1').amount).toBe(20)
    expect(line('labour:cad').amount).toBe(25)
    expect(line('labour:finish').amount).toBe(30)
    const materials = c.lines
      .filter((l) => ['metal', 'stones', 'setting', 'labour'].includes(l.group))
      .reduce((t, l) => t + l.amount, 0)
    expect(c.perPiece.materials).toBeCloseTo(materials, 2)
    expect(c.perPiece.cost).toBeCloseTo(materials * 1.1, 1)
    expect(c.perPiece.price).toBeCloseTo(c.perPiece.cost * 1.5 * 1.2, 1)
    expect(c.order.cost).toBeCloseTo(c.perPiece.cost * 4, 1)
    expect(c.placeholders).toEqual([])
  })

  it('flags every unset rate as a placeholder and shows its inputs', () => {
    const c = estimateCost(createContext(input()))
    expect(c.placeholders).toContain('platinum spot')
    expect(c.placeholders).toContain('prong setting per stone')
    const metal = c.lines.find((l) => l.group === 'metal')!
    expect(metal.inputs.map((i) => i.source)).toEqual([
      'computed',
      'default',
      'default',
      'computed',
      'default',
    ])
  })

  it('honours the production.create overrides and customer-supplied stones', () => {
    const c = estimateCost(
      createContext(
        input({
          rates: { metalPricePerGramUsd: 40, laborUsd: 150, settingPerStoneUsd: 12 },
          stonesSuppliedBy: { center: 'brand' },
        }),
      ),
    )
    expect(c.lines.find((l) => l.group === 'metal')!.amount).toBeCloseTo(
      METALS.pt950.density * 1.05 * 40,
      2,
    )
    expect(c.lines.filter((l) => l.group === 'labour').map((l) => l.amount)).toEqual([150])
    expect(c.lines.find((l) => l.id === 'setting:S1')!.amount).toBe(12)
    expect(c.lines.find((l) => l.id === 'stones:S1')!.amount).toBe(0)
  })

  it('prices attached stones from sourcing', () => {
    const design = templateDesign('solitaire')
    const gem = design.nodes.center!
    if (gem.kind !== 'gem') throw new Error()
    const sourced = {
      ...design,
      nodes: {
        ...design.nodes,
        center: { ...gem, sourcing: { provider: 'diaex', sku: 'D-77', priceUsd: 4321 } },
      },
    }
    const ctx = createContext(input({}, sourced))
    expect(ctx.lots[0]!.suppliedBy).toBe('brand')
    const s = estimateCost(ctx).lines.find((l) => l.id === 'stones:S1')!
    expect(s.amount).toBe(4321)
    expect(s.inputs.find((i) => i.source === 'sourcing')!.value).toBe(4321)
  })
})

describe('CSV', () => {
  it('quotes per RFC 4180 and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('-0.5')).toBe('-0.5')
    expect(csvCell(-0.5)).toBe('-0.5')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(true)).toBe('yes')
  })

  it('writes UTF-8 with a BOM and CRLF rows for Excel', () => {
    const bytes = encodeCsv(
      toCsv(
        ['a', 'b'],
        [
          ['Pavé', 1],
          ['µm', null],
        ],
      ),
    )
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes.subarray(3))).toBe('a,b\r\nPavé,1\r\nµm,\r\n')
  })
})

describe('file names', () => {
  it('are safe on Windows, macOS and Linux', () => {
    expect(safeSegment('Ring: "Ève"/<v2>?')).toBe('Ring-Eve-v2')
    expect(safeSegment('CON')).toBe('_CON')
    expect(safeSegment('nul.txt')).toBe('_nul.txt')
    expect(safeSegment('trailing. . ')).toBe('trailing')
    expect(safeSegment('   ')).toBe('item')
    expect(safeSegment('x'.repeat(200))).toHaveLength(64)
    expect(skuSlug('PV/2026*001')).toBe('PV-2026-001')
    expect(bundleRoot('Ané 01', 3)).toBe('Ane-01_r3_production')
  })

  it('stay unique case-insensitively', () => {
    const taken = new Set<string>()
    expect(['a.stl', 'A.stl', 'a.stl'].map((n) => uniqueName(n, taken))).toEqual([
      'a.stl',
      'A-2.stl',
      'a-3.stl',
    ])
  })
})

describe('chains in the package', () => {
  const base = (
    design: ReturnType<typeof templateDesign>,
    evaluation: BuildInput['evaluation'],
  ): BuildInput => ({
    piece: { id: 'p', title: 'Test', kind: 'pendant', sku: 'T-1' },
    revision: 1,
    design,
    evaluation,
    kernel: fixtureKernel(evaluation),
    fonts: {
      sans: { regular: new Uint8Array(), medium: new Uint8Array(), semibold: new Uint8Array() },
      serif: new Uint8Array(),
    },
    options: { quantity: 1, date: '2026-11-23', author: { name: 'A' }, org: { name: 'O' } },
  })

  it('draws and casts a chain that is the whole piece', () => {
    const evaluation = evaluationOf([
      { id: 'chain', name: 'Chain', mesh: box([0, 0, 0], [4, 100, 4]) },
    ])
    const ctx = createContext(base(templateDesign('cuban'), evaluation))
    expect(ctx.drawn.parts).toHaveLength(1)
    expect(Number.isFinite(ctx.drawn.report.bounds.max[1])).toBe(true)
    const bom = billOfMaterials(ctx)
    expect(bom.filter((l) => l.type === 'metal')).toHaveLength(1)
    expect(bom.filter((l) => l.type === 'finding')).toHaveLength(0)
  })

  it('leaves a threaded chain and its stones out of the drawing and the casting order', () => {
    const evaluation = evaluationOf(
      [
        { id: 'head', name: 'Head', mesh: box([-4, -2, -4], [4, 2, 4]) },
        { id: 'chain', name: 'Chain', mesh: box([-60, -1, 0], [60, 1, 200]) },
      ],
      [
        stoneAt('center:0', 'center', 6, [0, 0, 3]),
        stoneAt('chain:0', 'chain', 3, [50, 0, 150], 'melee'),
      ],
    )
    const ctx = createContext(base(templateDesign('pendant-solitaire'), evaluation))
    expect(ctx.drawn.stones.map((s) => s.id)).toEqual(['center:0'])
    expect(ctx.drawn.report.bounds.max[2]).toBeLessThan(10)
    const bom = billOfMaterials(ctx)
    expect(bom.filter((l) => l.type === 'metal').map((l) => l.item)).toEqual(['Head'])
    const chain = bom.find((l) => l.type === 'finding' && l.item.toLowerCase().includes('chain'))
    expect(chain?.netWeightG).toBeGreaterThan(0)
    const order = bom.find((l) => l.type === 'metal-order')!
    const head = bom.find((l) => l.type === 'metal')!
    expect(order.netWeightG).toBeCloseTo(head.netWeightG!, 3)
  })
})
