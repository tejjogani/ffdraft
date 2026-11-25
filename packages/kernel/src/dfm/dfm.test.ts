import {
  applyOps,
  buildDesign,
  designFrom,
  GEM_CUT_IDS,
  type NodeInput,
  TEMPLATES,
} from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createKernel, type LocalKernel } from '../kernel'
import { manufacturabilityDiagnostics, profileWith } from './index'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

const at = (x: number, y: number, z: number) => ({
  position: [x, y, z] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: 1,
})
const codesOf = async (nodes: NodeInput[], profile = profileWith({})) => {
  const scene = await kernel.scene(designFrom('other', nodes), { detail: 'production' })
  return manufacturabilityDiagnostics(scene, profile).map((d) => d.code)
}
const plate: NodeInput = {
  id: 'plate',
  kind: 'primitive',
  name: 'Plate',
  shape: 'box',
  size: [16, 2, 16],
}

describe('manufacturability checks', () => {
  it('flags wires below the profile minimums from node parameters', async () => {
    const codes = await codesOf([
      plate,
      { id: 'post', kind: 'finding', type: 'earringPost', host: 'plate', wire: 0.5 },
      {
        id: 'chain',
        kind: 'chain',
        style: 'cable',
        layout: 'straight',
        length: 100,
        linkWidth: 1.2,
        wire: 0.3,
      },
    ])
    expect(codes).toContain('post.thin')
    expect(codes).toContain('chain.fine')
  })

  it('keeps every check running whatever the cut of a stone in the piece', async () => {
    for (const cut of GEM_CUT_IDS) {
      const codes = await codesOf([
        { id: 'gem', kind: 'gem', cut, width: 4, transform: at(0, 0, 20) },
        plate,
        { id: 'post', kind: 'finding', type: 'earringPost', host: 'plate', wire: 0.5 },
      ])
      expect(codes, cut).toContain('post.thin')
      expect(codes, cut).not.toContain('dfm.unavailable')
    }
  })

  it('checks the bail against the chain passing through it', async () => {
    const pendant = (opening: number, width: number) => [
      plate,
      { id: 'bail', kind: 'bail', host: 'plate', style: 'ring', opening, wire: 1.2 } as NodeInput,
      {
        id: 'chain',
        kind: 'chain',
        style: 'cuban',
        through: 'bail',
        linkWidth: width,
        wire: width * 0.28,
      } as NodeInput,
    ]
    const tight = await codesOf(pendant(5, 6))
    expect(tight).toContain('bail.small')
    expect(tight).toContain('chain.clash')
    const roomy = await codesOf(pendant(12, 4))
    expect(roomy).not.toContain('bail.small')
    expect(roomy).not.toContain('chain.clash')
  })

  it('finds a finding that does not touch its host', async () => {
    const codes = await codesOf([
      plate,
      {
        id: 'ring',
        kind: 'finding',
        type: 'jumpRing',
        host: 'plate',
        length: 4,
        wire: 0.8,
        transform: at(0, 0, 6),
      },
    ])
    expect(codes).toContain('metal.disconnected')
    expect(
      await codesOf([
        plate,
        { id: 'ring', kind: 'finding', type: 'jumpRing', host: 'plate', length: 4, wire: 0.8 },
      ]),
    ).not.toContain('metal.disconnected')
  })

  it('finds a head that floats off its shank, but not a butterfly back', async () => {
    const solitaire = buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)
    const lifted = applyOps(solitaire, [
      { t: 'update', id: 'center', patch: { transform: at(0, 0, 6) } },
    ]).design
    const floating = await kernel.scene(lifted, { detail: 'production' })
    const loose = manufacturabilityDiagnostics(floating).filter(
      (d) => d.code === 'metal.disconnected',
    )
    expect(loose.map((d) => d.nodeId)).toEqual(['head'])
    const seated = await kernel.scene(solitaire, { detail: 'production' })
    expect(manufacturabilityDiagnostics(seated).map((d) => d.code)).not.toContain(
      'metal.disconnected',
    )
    expect(
      await codesOf([plate, { id: 'back', kind: 'finding', type: 'butterfly', host: 'plate' }]),
    ).not.toContain('metal.disconnected')
  })

  it('reports short seat walls once per node', async () => {
    const eternity = buildDesign(TEMPLATES.find((t) => t.id === 'eternity')!.spec)
    const scene = await kernel.scene(eternity, { detail: 'production' })
    const walls = manufacturabilityDiagnostics(scene).filter((d) => d.code === 'seat.wall')
    expect(new Set(walls.map((d) => d.nodeId)).size).toBe(walls.length)
  })

  it('finds stones that collide or sit in metal without a seat, each pair once', async () => {
    const design = designFrom('other', [
      { id: 'a', kind: 'gem', width: 3, transform: at(0, 0, 20) },
      { id: 'b', kind: 'gem', width: 3, transform: at(2, 0, 20) },
      plate,
      { id: 'sunk', kind: 'gem', width: 2, transform: at(4, 0, 0) },
    ])
    const e = await kernel.evaluate(design, { detail: 'production' })
    const codes = e.diagnostics.map((d) => d.code)
    // Girdles that cross are the evaluator's stone.overlap; the exact check does not repeat them.
    expect(codes.filter((c) => c === 'stone.overlap')).toHaveLength(1)
    expect(codes).not.toContain('stone.collision')
    expect(codes).toContain('stone.inMetal')
  })

  it('finds pavilions that cross below girdles that do not touch', async () => {
    // Two stones tilted towards each other: girdles apart, pavilions through each other.
    const tilt = (x: number, angle: number) => ({
      ...at(x, 0, 20),
      rotation: [0, angle, 0] as [number, number, number],
    })
    const codes = await codesOf([
      { id: 'a', kind: 'gem', width: 4, transform: tilt(-1.2, -60) },
      { id: 'b', kind: 'gem', width: 4, transform: tilt(1.2, 60) },
    ])
    expect(codes).toContain('stone.collision')
  })

  it('tells a stone entombed in metal (an error) from a seat cutting metal off', async () => {
    const codes = await kernel.evaluate(
      designFrom('other', [
        { id: 'plate', kind: 'primitive', name: 'Plate', shape: 'box', size: [16, 16, 2] },
        { id: 'sunk', kind: 'gem', width: 2, transform: at(4, 0, 0.6) },
      ]),
      { detail: 'production' },
    )
    expect(codes.diagnostics.map((d) => d.code)).not.toContain('seat.through')
    expect(codes.diagnostics.find((d) => d.code === 'stone.inMetal')?.level).toBe('error')
  })

  it('finds stones that nothing holds', async () => {
    const solitaire = buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)
    for (const detail of ['draft', 'production'] as const)
      expect(
        (await kernel.evaluate(solitaire, { detail })).diagnostics.map((d) => d.code),
      ).not.toContain('stone.unheld')
    const moved = applyOps(solitaire, [
      { t: 'update', id: 'head', patch: { transform: at(8, 0, 0) } },
    ]).design
    const draft = await kernel.evaluate(moved)
    expect(draft.diagnostics.find((d) => d.code === 'stone.unheld')?.level).toBe('warning')
    const production = await kernel.evaluate(moved, { detail: 'production' })
    expect(production.diagnostics.find((d) => d.code === 'stone.unheld')?.level).toBe('error')
  })

  it('reports metal that touches nothing else as a separate casting', async () => {
    const codes = await codesOf([
      { id: 'band', kind: 'ringShank' },
      { id: 'ball', kind: 'primitive', shape: 'sphere', size: [2, 2, 2], transform: at(0, 0, 16) },
    ])
    expect(codes).toContain('metal.separate')
    expect(await codesOf([{ id: 'band', kind: 'ringShank' }])).not.toContain('metal.separate')
  })

  it('takes a two-tone head as a separate casting seated on the band, weighed once', async () => {
    const solitaire = buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)
    const one = await kernel.evaluate(solitaire, { detail: 'production' })
    const twoTone = applyOps(solitaire, [
      { t: 'update', id: 'head', patch: { material: 'au18k-yellow' } },
    ]).design
    const two = await kernel.evaluate(twoTone, { detail: 'production' })
    const codes = two.diagnostics.map((d) => d.code)
    expect(codes).not.toContain('metal.disconnected')
    expect(codes).toContain('metal.separateCasting')
    const total = (e: typeof one) => e.parts.reduce((sum, p) => sum + p.volumeMm3, 0)
    // A head of its own alloy gets a base rail so it casts in one piece; the rest is the same
    // metal, weighed once.
    const head = (await kernel.scene(twoTone, { detail: 'production' })).nodes.get('head')!
    const rail = head.bodies[head.bodies.length - 1]!.solid.volume()
    expect(total(two) - total(one)).toBeGreaterThan(0)
    expect(total(two) - total(one)).toBeLessThan(rail + 0.5)
    const moved = applyOps(twoTone, [
      { t: 'update', id: 'head', patch: { transform: at(0, 0, 3) } },
    ])
    expect(
      (await kernel.evaluate(moved.design, { detail: 'production' })).diagnostics.map(
        (d) => d.code,
      ),
    ).toContain('metal.disconnected')
  })

  it('runs the size rules at draft too, and warns about an absurd weight', async () => {
    const e = await kernel.evaluate(
      designFrom('other', [
        plate,
        { id: 'post', kind: 'finding', type: 'earringPost', host: 'plate', wire: 0.5 },
      ]),
    )
    expect(e.diagnostics.map((d) => d.code)).toContain('post.thin')
    const huge = await kernel.evaluate(
      designFrom('other', [{ ...plate, size: [80, 80, 20] } as NodeInput]),
    )
    expect(huge.diagnostics.map((d) => d.code)).toContain('metal.heavy')
  })

  it('leaves a chain out of the caster’s envelope', async () => {
    const pendant = buildDesign(TEMPLATES.find((t) => t.id === 'pendant-solitaire')!.spec)
    const e = await kernel.evaluate(pendant, { detail: 'production' })
    expect(e.diagnostics.map((d) => d.code)).not.toContain('piece.large')
  })

  it('applies the profile’s casting limits', async () => {
    const codes = await codesOf([plate], profileWith({ maxTriangles: 4, envelope: [1, 1, 1] }))
    expect(codes).toContain('mesh.dense')
    expect(codes).toContain('piece.large')
    expect(await codesOf([plate])).toEqual([])
  })
})

describe('one finding per cause', () => {
  const template = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
  const found = async (design: ReturnType<typeof template>) =>
    (await kernel.evaluate(design, { detail: 'production' })).diagnostics

  it('an engraving that cuts the band apart is not also a loose band', async () => {
    const design = applyOps(template('wedding-band'), [
      { t: 'update', id: 'band', patch: { thicknessTop: 1, thicknessBottom: 1 } },
      { t: 'add', node: { id: 'eng', kind: 'engraving', host: 'band', text: 'forever', depth: 2 } },
    ]).design
    const codes = (await found(design)).map((d) => d.code)
    expect(codes).toContain('engraving.through')
    expect(codes).not.toContain('metal.separate')
  })

  it('a stone buried in metal is buried, not unheld', async () => {
    const codes = (
      await found(
        designFrom('other', [
          { id: 'ball', kind: 'primitive', shape: 'sphere', size: [10, 10, 10] },
          { id: 'lost', kind: 'gem', width: 2 },
        ]),
      )
    ).map((d) => d.code)
    expect(codes).toContain('stone.inMetal')
    expect(codes).not.toContain('stone.unheld')
  })

  it('a flush setting with nothing to sink into is reported once, by the setting', async () => {
    const flush = applyOps(template('solitaire'), [
      { t: 'update', id: 'head', patch: { style: 'flush' } },
    ]).design
    const codes = (await found(flush)).map((d) => d.code)
    expect(codes).toContain('setting.noHost')
    expect(codes).not.toContain('stone.unheld')
    expect(codes).not.toContain('seat.wall')
  })

  it('names stones by their feature, not by internal ids', async () => {
    const moved = applyOps(template('eternity'), [
      { t: 'update', id: 'row', patch: { transform: at(0, 0, 30) } },
    ]).design
    const unheld = (await kernel.evaluate(moved)).diagnostics.find((d) => d.code === 'stone.unheld')
    expect(unheld?.message).toMatch(/“[^”]+”, stone \d+/)
    expect(unheld?.message).not.toMatch(/row:\d/)
    expect(unheld?.related?.[0]).toMatch(/^row:\d+$/)
  })

  it('states an absurd weight in readable kilograms', async () => {
    const huge = designFrom('other', [
      { id: 'b', kind: 'primitive', shape: 'box', size: [200, 200, 200] },
    ])
    const heavy = (await kernel.evaluate(huge)).diagnostics.find((d) => d.code === 'metal.heavy')
    expect(heavy?.message).toMatch(/\d{1,3}(,\d{3})*(\.\d)? kg/)
  })
})

describe('walls too thin to cast', () => {
  it('finds a 0.3 mm plate and a 0.4 mm wire, and says so in the STL notes', async () => {
    const foil = designFrom('other', [
      { id: 'foil', kind: 'primitive', name: 'Foil', shape: 'box', size: [12, 12, 0.3] },
    ])
    const wire = designFrom('other', [
      {
        id: 'wire',
        kind: 'pipe',
        name: 'Wire',
        points: [
          [-20, 0, 0],
          [0, 0, 0],
          [20, 0, 0],
        ],
        width: 0.4,
        thickness: 0.4,
      },
    ])
    for (const [design, id] of [
      [foil, 'foil'],
      [wire, 'wire'],
    ] as const) {
      const e = await kernel.evaluate(design, { detail: 'production' })
      expect(e.diagnostics.find((d) => d.code === 'wall.thin')?.nodeId).toBe(id)
      const stl = await kernel.export(design, 'stl')
      expect(stl.notes.join(' ')).toMatch(/Check before making: .*walls 0\.\d+ mm thin/)
    }
  })

  it('leaves solids with sharp or tangent rims and an overlapping bail alone', async () => {
    // A spike stud (45° rim), a dome (its side meets the base tangent to vertical), and the
    // hidden bail of a large iced pendant: a 2.2 mm wire loop whose shells overlap 0.001 mm.
    const designs = [
      designFrom('other', [
        { id: 'spike', kind: 'revolve', name: 'Spike', profile: 'M 0 0 L 5 0 L 0 5 Z' },
      ]),
      designFrom('other', [
        { id: 'dome', kind: 'revolve', name: 'Dome', profile: 'M 0 0 L 5 0 Q 5 4 0 5 Z' },
      ]),
      designFrom('pendant', [
        { id: 'body', kind: 'primitive', shape: 'box', size: [30, 4, 60] },
        {
          id: 'bail',
          kind: 'bail',
          host: 'body',
          style: 'hidden',
          opening: 5,
          width: 2.5,
          wire: 2.2,
        },
      ]),
    ]
    for (const design of designs) {
      const e = await kernel.evaluate(design, { detail: 'production' })
      expect(e.diagnostics.filter((d) => d.code === 'wall.thin')).toEqual([])
    }
    const stl = await kernel.export(designs[0]!, 'stl')
    expect(stl.notes.join(' ')).not.toMatch(/walls 0\.\d+ mm thin/)
  })

  it('leaves a 2 mm plate and the stock solitaire alone', async () => {
    const plateDesign = designFrom('other', [plate])
    const solitaire = buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)
    for (const design of [plateDesign, solitaire]) {
      const e = await kernel.evaluate(design, { detail: 'production' })
      expect(e.diagnostics.map((d) => d.code)).not.toContain('wall.thin')
    }
  })
})
