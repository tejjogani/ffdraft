import { describe, expect, it } from 'vitest'
import { emptyDesign } from '../design/design'
import { resolveDesign } from '../design/mount'
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
        // The ratio follows the cut (absent on the node) and resolves to the cut's own, which is
        // the ratio the carat was sized with.
        const stored = build() as NodeOf<'gem'>
        expect(stored.lw).toBeUndefined()
        const alone = { ...emptyDesign(), nodes: { [stored.id]: stored }, order: [stored.id] }
        const gem = resolveDesign(alone).nodes[stored.id] as NodeOf<'gem'>
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
    // The bail stands on the halo, the outermost metal, not on the head inside it.
    expect((halo.nodes.bail as NodeOf<'bail'>).host).toBe('halo')
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

  it('starts a custom ring from its band, with the centre stone when the brief names one', () => {
    // The ring recipe reads `custom` itself (a band, and a head only for a named centre), so a
    // custom ring must reach it; a custom pendant still starts empty.
    const ring = (stones: PieceSpecInput['stones']) =>
      planDesign({ kind: 'ring', archetype: 'custom', title: 't', summary: 's', stones })
    const bare = ring([])
    expect(bare.design.order.map((id) => bare.design.nodes[id]!.kind)).toEqual(['ringShank'])
    const toi = ring([{ role: 'center', cut: 'pear', widthMm: 6 }])
    expect(toi.design.nodes.center?.kind).toBe('gem')
    expect(toi.design.nodes.head?.kind).toBe('setting')
    expect(toi.notes.join(' ')).not.toMatch(/no recipe/)
    expect(buildDesign(pendant({ archetype: 'custom' })).order).toEqual([])
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

  it('closes every chain with a clasp: a box on a tennis line, a lobster on the rest', () => {
    // Without one the Cuban was a closed loop and the tennis bracelet a closed ring.
    const clasp = (id: string) =>
      (buildDesign(TEMPLATES.find((t) => t.id === id)!.spec).nodes.chain as NodeOf<'chain'>).clasp
    expect(clasp('cuban')).toBe('lobster')
    expect(clasp('tennis')).toBe('box')
    expect(clasp('iced-trophy')).toBe('lobster')
    expect(clasp('iced-initial')).toBe('box')
    expect(clasp('name-pendant')).toBe('lobster')
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

  it('hides the bail only behind a paved body tall enough to hide it high up', () => {
    const bail = (spec: PieceSpecInput) => planDesign(spec).design.nodes.bail as NodeOf<'bail'>
    // A pavé role on a solitaire pendant: the bail stands on the head, never behind it, and
    // the pavé (which a head has no face for) is left out with a note.
    const sol = planDesign(
      pendant({
        stones: [
          { role: 'center', carat: 0.5 },
          { role: 'pave', widthMm: 1.3 },
        ],
        chain: { style: 'cable', lengthMm: 450, widthMm: 1.2 },
      }),
    )
    expect((sol.design.nodes.bail as NodeOf<'bail'>).style).toBe('ring')
    expect(sol.design.nodes.ice).toBeUndefined()
    expect(sol.notes.join(' ')).toMatch(/no body to pavé/)
    // A 3 mm and a 12 mm iced piece cannot hide a slot high enough: a tube on top.
    for (const heightMm of [3, 12])
      expect(
        bail(
          pendant({
            archetype: 'icedPendant',
            body: { heightMm },
            chain: { style: 'cuban', lengthMm: 560, widthMm: 8 },
          }),
        ).style,
      ).toBe('tube')
    // The slot's hole lands well inside the body's top third, where bail.hiddenLow is quiet.
    for (const t of ['iced-trophy', 'iced-initial']) {
      const spec = TEMPLATES.find((x) => x.id === t)!.spec
      const b = bail(spec)
      expect(b.style).toBe('hidden')
      expect(1.5 * b.wire + b.opening / 2).toBeLessThanOrEqual(0.3 * spec.body!.heightMm)
    }
  })

  it('hides a bail only under a sculpt or a single letter, never under a word', () => {
    const bail = (spec: PieceSpecInput) => buildDesign(spec).nodes.bail as NodeOf<'bail'>
    const pave = [{ role: 'pave' as const, widthMm: 1.1 }]
    // A word's top over its centre of mass is a lowercase letter or the dip between letters,
    // far under the body's height: a slot sized from the height sat at the centre of mass.
    for (const heightMm of [14, 20, 30]) {
      for (const text of ['Tej', 'Amara', 'Isabella'])
        expect(
          bail(pendant({ archetype: 'namePendant', body: { heightMm, text }, stones: pave })).style,
        ).not.toBe('hidden')
      expect(
        bail(
          pendant({
            archetype: 'icedPendant',
            body: { heightMm, text: 'BOSS', iceLevel: 1 },
            stones: pave,
          }),
        ).style,
      ).not.toBe('hidden')
    }
    // One letter has metal across its top: hidden, when tall enough.
    expect(
      bail(pendant({ archetype: 'icedPendant', body: { heightMm: 32, text: 'A' }, stones: pave }))
        .style,
    ).toBe('hidden')
    // A sculpt is hidden from the size whose neck takes a strap up to the size whose open back
    // a strap still spans; outside that, a bail on top.
    const trophy = (heightMm: number) =>
      bail(pendant({ archetype: 'icedPendant', body: { heightMm }, stones: pave })).style
    expect([16, 20].map(trophy)).not.toContain('hidden')
    expect([25, 45, 100, 120].map(trophy)).toEqual(['hidden', 'hidden', 'hidden', 'hidden'])
    expect([150, 200].map(trophy)).toEqual(['tube', 'tube'])
    // The bail on a very large piece is the largest the node takes, not one the fit clamps.
    const huge = planDesign(
      pendant({ archetype: 'icedPendant', body: { heightMm: 200 }, stones: pave }),
    )
    expect((huge.design.nodes.bail as NodeOf<'bail'>).opening).toBe(20)
    expect(huge.notes.join(' ')).not.toMatch(/Bail/)
  })

  it('sets an iced name in block letters, which take stones', () => {
    const body = (stones: PieceSpecInput['stones']) =>
      buildDesign(
        pendant({ archetype: 'namePendant', body: { heightMm: 14, text: 'Amara' }, stones }),
      ).nodes.body as NodeOf<'vectorBody'>
    const iced = body([{ role: 'pave', widthMm: 1.1 }])
    expect(iced.source).toMatchObject({ type: 'text', font: 'block' })
    expect(body([]).source).toMatchObject({ type: 'text', font: 'script' })
    // Under 14 mm the letters take no stone with its seat wall, and the plan says so.
    const notes = (heightMm: number) =>
      planDesign(
        pendant({
          archetype: 'namePendant',
          body: { heightMm, text: 'Tej' },
          stones: [{ role: 'pave', widthMm: 1.1 }],
        }),
      ).notes.join(' ')
    expect(notes(10)).toMatch(/too thin to take 1.1 mm stones/)
    expect(notes(14)).not.toMatch(/too thin/)
  })

  it('agrees with the canon on a hidden bail’s opening', () => {
    // The canon's bail.opening floor for a hidden slot (fitted on the kernel's hole): flat links
    // 1.15 × w + 2, tennis 2.05 × w + 3.6, round 2.18 × w + 0.95.
    const iced = (style: 'cuban' | 'tennis' | 'cable', widthMm: number) =>
      planDesign(
        pendant({
          archetype: 'icedPendant',
          body: { heightMm: 60 },
          chain: { style, lengthMm: 560, widthMm },
        }),
      ).design.nodes.bail as NodeOf<'bail'>
    expect(iced('cuban', 8).opening).toBeGreaterThanOrEqual(1.15 * 8 + 2)
    expect(iced('tennis', 3).opening).toBeGreaterThanOrEqual(2.05 * 3 + 3.6)
    expect(iced('cable', 4).opening).toBeGreaterThanOrEqual(2.18 * 4 + 0.95)
    // A 2 mm tennis line is 3.1 mm deep as built: the slot, 0.6 of its opening deep, takes that
    // with the 1.5 mm the kernel's bail check asks for.
    expect(0.6 * iced('tennis', 2).opening).toBeGreaterThanOrEqual(3.1 + 1.5)
  })

  it('rounds chain wire down, so the kernel does not thin it', () => {
    // The archetype names the piece; the chain spec picks the style.
    const wire = (style: 'rope' | 'box', widthMm: number) =>
      (
        buildDesign({
          kind: 'chain',
          archetype: 'cuban',
          title: 't',
          summary: 's',
          chain: { style, lengthMm: 450, widthMm },
        }).nodes.chain as NodeOf<'chain'>
      ).wire
    // The kernel's caps: rope w / 8, box w / 5.5.
    expect(wire('rope', 3)).toBeLessThanOrEqual(3 / 8)
    expect(wire('box', 3)).toBeLessThanOrEqual(3 / 5.5)
  })

  it('frames halo studs with their halo, and says a brooch has no pin yet', () => {
    const studs = buildDesign({
      kind: 'earrings',
      archetype: 'halo',
      title: 't',
      summary: 's',
      stones: [
        { role: 'center', carat: 0.5 },
        { role: 'halo', widthMm: 1.1 },
      ],
    })
    expect(studs.nodes.halo?.kind).toBe('halo')
    expect((studs.nodes.pair as NodeOf<'pattern'>).sources).toContain('halo')
    const brooch = planDesign({
      kind: 'brooch',
      archetype: 'medallion',
      title: 't',
      summary: 's',
      body: { heightMm: 30 },
    })
    expect(brooch.design.nodes.bail).toBeUndefined()
    expect(brooch.notes.join(' ')).toMatch(/brooch pin/)
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

describe('engraving in the band recipe', () => {
  // A 60-letter engraving (the spec's longest) once went through at 1.4 mm letters, so a
  // US 4 band started life with engraving.tooLong.
  it('sets a long engraving small enough to fit inside the band, and leaves short ones alone', () => {
    const band = (value: number, engraving: string) =>
      buildDesign({
        kind: 'ring',
        archetype: 'band',
        title: 't',
        summary: 's',
        ring: { size: { system: 'us', value } },
        engraving,
      }).nodes.engraving as NodeOf<'engraving'>
    const long = 'forever and always '.repeat(4).slice(0, 60)
    // 97 % of the inside of a US 4 (14.9 mm) at the kernel's measured 0.66 mm per letter per mm.
    expect(band(4, long).size).toBeLessThanOrEqual(1.1)
    expect(band(4, long).size).toBeGreaterThanOrEqual(0.6)
    expect(band(13, long).size).toBeGreaterThan(band(4, long).size)
    expect(band(4, 'forever').size).toBe(1.4)
  })
})
