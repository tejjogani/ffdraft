import { describe, expect, it } from 'vitest'
import type { NodeOf } from '../design/nodes'
import type { PieceSpecInput } from '../design/spec'
import { GEM_CUT_IDS, GEM_CUTS, gemCarat, gemDims } from '../domain/gems'
import { buildDesign, planDesign, TEMPLATES } from './index'

const pendant = (extra: Partial<PieceSpecInput>): PieceSpecInput => ({
  kind: 'pendant',
  archetype: 'pendantSolitaire',
  title: 't',
  summary: 's',
  ...extra,
})

describe('recipes', () => {
  it.each(GEM_CUT_IDS)(
    'builds a 1 ct %s at 1 ct: the gem carries the ratio it was sized for',
    (cut) => {
      for (const build of [
        () => buildDesign(pendant({ stones: [{ role: 'center', cut, carat: 1 }] })).nodes.center,
        () =>
          buildDesign({
            kind: 'ring',
            archetype: 'solitaire',
            title: 't',
            summary: 's',
            stones: [{ role: 'center', cut, carat: 1 }],
          }).nodes.center,
        () =>
          buildDesign({
            kind: 'earrings',
            archetype: 'studs',
            title: 't',
            summary: 's',
            stones: [{ role: 'center', cut, carat: 1 }],
          }).nodes.stone,
      ]) {
        const gem = build() as NodeOf<'gem'>
        expect(gem.lw).toBe(GEM_CUTS[cut].lw.default)
        const carat = gemCarat(cut, gemDims(cut, gem.width, gem.lw))
        expect(carat).toBeGreaterThan(0.99)
        expect(carat).toBeLessThan(1.01)
      }
    },
  )

  it('passes a requested length : width to stud stones', () => {
    const d = buildDesign({
      kind: 'earrings',
      archetype: 'studs',
      title: 't',
      summary: 's',
      stones: [{ role: 'center', cut: 'oval', carat: 1, lw: 1.3 }],
    })
    const gem = d.nodes.stone as NodeOf<'gem'>
    expect(gem.lw).toBe(1.3)
    expect(gemCarat('oval', gemDims('oval', gem.width, gem.lw))).toBeCloseTo(1, 2)
  })

  it('gives a flush stud a bezel, which needs no host body', () => {
    const d = buildDesign({
      kind: 'earrings',
      archetype: 'studs',
      title: 't',
      summary: 's',
      stones: [{ role: 'center', carat: 0.5, setting: 'flush' }],
    })
    expect((d.nodes.head as NodeOf<'setting'>).style).toBe('bezel')
  })

  // Every spec the schema accepts builds: values past a node's range are clamped and noted.
  const extremes: [string, PieceSpecInput][] = [
    [
      'a 25 mm chain',
      {
        kind: 'chain',
        archetype: 'cuban',
        title: 't',
        summary: 's',
        chain: { style: 'cuban', lengthMm: 500, widthMm: 25 },
      },
    ],
    [
      'a pendant on a 20 mm chain',
      pendant({
        archetype: 'icedPendant',
        body: { heightMm: 40 },
        chain: { style: 'cuban', lengthMm: 500, widthMm: 20 },
      }),
    ],
    ['ice level 0', pendant({ archetype: 'icedPendant', body: { heightMm: 30, iceLevel: 0 } })],
    [
      '0.5 mm pavé',
      pendant({
        archetype: 'icedPendant',
        body: { heightMm: 30 },
        stones: [{ role: 'pave', widthMm: 0.5 }],
      }),
    ],
    [
      '5 mm pavé',
      pendant({
        archetype: 'icedPendant',
        body: { heightMm: 30 },
        stones: [{ role: 'pave', widthMm: 5 }],
      }),
    ],
    [
      'a 5 mm halo',
      {
        kind: 'ring',
        archetype: 'halo',
        title: 't',
        summary: 's',
        stones: [
          { role: 'center', carat: 1 },
          { role: 'halo', widthMm: 5 },
        ],
      },
    ],
    [
      'an 8 mm accent',
      {
        kind: 'ring',
        archetype: 'solitaire',
        title: 't',
        summary: 's',
        stones: [
          { role: 'center', carat: 1 },
          { role: 'accent', widthMm: 8 },
        ],
      },
    ],
    [
      'a 200 mm name',
      pendant({ archetype: 'namePendant', body: { heightMm: 200, text: 'Ann', thicknessMm: 30 } }),
    ],
    ['a 3 mm medallion', pendant({ archetype: 'medallion', body: { heightMm: 3 } })],
    ['a 120 mm medallion', pendant({ archetype: 'medallion', body: { heightMm: 120 } })],
    ['a 0.5 mm centre', pendant({ stones: [{ role: 'center', widthMm: 0.5 }] })],
    [
      'ring size us −3',
      {
        kind: 'ring',
        archetype: 'band',
        title: 't',
        summary: 's',
        ring: { size: { system: 'us', value: -3 } },
      },
    ],
    [
      'ring size eu 500',
      {
        kind: 'ring',
        archetype: 'band',
        title: 't',
        summary: 's',
        ring: { size: { system: 'eu', value: 500 } },
      },
    ],
    [
      '1 mm tennis',
      {
        kind: 'bracelet',
        archetype: 'tennis',
        title: 't',
        summary: 's',
        chain: { style: 'tennis', lengthMm: 180, widthMm: 1 },
      },
    ],
  ]
  it.each(extremes)('builds %s, noting what it changed', (_, spec) => {
    const { design, notes } = planDesign(spec)
    expect(Object.keys(design.nodes).length).toBeGreaterThan(0)
    expect(notes.length).toBeGreaterThan(0)
    for (const n of Object.values(design.nodes))
      if (n?.kind === 'pave') expect(n.sizeMin).toBeLessThanOrEqual(n.sizeMax)
  })

  it('keeps the smallest pavé stone at or under the largest', () => {
    const d = buildDesign(
      pendant({
        archetype: 'icedPendant',
        body: { heightMm: 30 },
        stones: [{ role: 'pave', widthMm: 0.9 }],
      }),
    )
    const ice = d.nodes.ice as NodeOf<'pave'>
    expect(ice.sizeMin).toBeLessThanOrEqual(ice.sizeMax)
  })

  it('leaves the pavé out at ice level 0', () => {
    const d = buildDesign(
      pendant({ archetype: 'icedPendant', body: { heightMm: 30, iceLevel: 0 } }),
    )
    expect(d.nodes.ice).toBeUndefined()
  })

  it('builds what the archetype asks for, or says it has no recipe', () => {
    const halo = buildDesign(pendant({ archetype: 'halo', stones: [{ role: 'center', carat: 1 }] }))
    expect(halo.nodes.center?.kind).toBe('gem')
    expect(halo.nodes.halo?.kind).toBe('halo')
    expect((halo.nodes.bail as NodeOf<'bail'>).host).toBe('head')
    for (const spec of [
      { kind: 'bracelet', archetype: 'band' },
      { kind: 'ring', archetype: 'cuban' },
      { kind: 'ring', archetype: 'namePendant' },
    ] as const) {
      const { design, notes } = planDesign({ ...spec, title: 't', summary: 's' })
      expect(Object.keys(design.nodes)).toHaveLength(0)
      expect(notes.join(' ')).toMatch(/no recipe/)
    }
  })

  it('sets a tennis line from its accent stones', () => {
    const d = buildDesign({
      kind: 'bracelet',
      archetype: 'tennis',
      title: 't',
      summary: 's',
      chain: { style: 'tennis', lengthMm: 180, widthMm: 3.4 },
      stones: [{ role: 'accent', cut: 'princess', widthMm: 2.5 }],
    })
    const chain = d.nodes.chain as NodeOf<'chain'>
    expect(chain.cut).toBe('princess')
    expect(chain.linkWidth).toBeCloseTo(2.9, 5)
    expect(chain.wire).toBeGreaterThanOrEqual(0.8)
  })

  it('sizes the bail from the chain it carries and the piece it hangs', () => {
    const bail = (spec: PieceSpecInput) => buildDesign(spec).nodes.bail as NodeOf<'bail'>
    // Fine round chain: a ring that passes the link plus 1.5 mm.
    const fine = bail(
      pendant({
        stones: [{ role: 'center', carat: 0.5 }],
        chain: { style: 'cable', lengthMm: 450, widthMm: 1.2 },
      }),
    )
    expect(fine.style).toBe('ring')
    expect(fine.opening).toBeGreaterThanOrEqual(1.2 + 1.7)
    // A heavy Cuban under a big plain piece: a tube, a heavier wire, past the link's diagonal.
    const heavy = bail(
      pendant({
        archetype: 'medallion',
        body: { heightMm: 60 },
        chain: { style: 'cuban', lengthMm: 560, widthMm: 8 },
      }),
    )
    expect(heavy.style).toBe('tube')
    expect(heavy.opening).toBeGreaterThan(8 * 1.15 + 2)
    expect(heavy.wire).toBeGreaterThan(1.5)
    // Behind a paved front: a hidden bail, its slot taking the link's width with 1.5 mm to spare.
    const iced = bail(
      pendant({
        archetype: 'icedPendant',
        body: { heightMm: 45 },
        chain: { style: 'cuban', lengthMm: 560, widthMm: 8 },
      }),
    )
    expect(iced.style).toBe('hidden')
    expect(iced.opening).toBeGreaterThan(8 + 1.5)
  })

  it('hollows and flat-backs a sculpted iced body', () => {
    const d = buildDesign(TEMPLATES.find((t) => t.id === 'iced-trophy')!.spec)
    const body = d.nodes.body as NodeOf<'meshBody'>
    expect(body.hollow).toBeGreaterThanOrEqual(1.2)
    expect(body.flatBack).toBeGreaterThanOrEqual(0.5)
  })

  it('builds every template with nothing to note', () => {
    for (const t of TEMPLATES) expect(planDesign(t.spec).notes, t.id).toEqual([])
  })
})
