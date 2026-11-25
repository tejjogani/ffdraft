import { applyOps, buildDesign, designFrom, type NodeInput, TEMPLATES } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createKernel, type LocalKernel } from '../kernel'
import { clearSpan, holeProfile } from './chain/seat'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

const template = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
const name = (text: string) =>
  buildDesign({
    kind: 'pendant',
    archetype: 'namePendant',
    title: text,
    summary: text,
    body: { heightMm: 9, text },
    chain: { style: 'cable', lengthMm: 406, widthMm: 1.2 },
  })

describe('bail', () => {
  it.each(['pendant-solitaire', 'name-pendant', 'iced-trophy', 'iced-initial'])(
    '%s evaluates at production with no errors, and the chain is not cast into the pendant',
    async (id) => {
      const design = template(id)
      const scene = await kernel.scene(design, { detail: 'production' })
      const errors = scene.evaluation.diagnostics.filter((d) => d.level === 'error')
      expect(errors.map((d) => `${d.code}: ${d.message}`)).toEqual([])
      // The chain is its own part with exactly its own metal; the casting holds no links.
      const chain = scene.nodes.get('chain')!
      const parts = scene.evaluation.parts
      const chainPart = parts.find((p) => p.nodeId === 'chain')!
      expect(chainPart.volumeMm3).toBeCloseTo(chain.bodies[0]!.solid.volume(), 3)
      const casting = parts.filter((p) => p !== chainPart)
      expect(casting).toHaveLength(1)
      const box = casting[0]!.bounds
      const chainLow = chain.bodies[0]!.solid.bounds().min[2]
      // Nothing of the casting reaches far up the chain (links fused on would).
      expect(box.max[2]).toBeLessThan(chainLow + 12)
    },
    60_000,
  )

  // Recipe pendants beyond the templates: a halo pendant (its bail on the halo, not the head),
  // a solitaire with a pavé role (never a hidden bail), an iced letter on a 2 mm tennis line
  // (a tube on top: a hidden slot would show through the letter), and a small iced trophy whose
  // scoop is shallow.
  const recipe = (archetype: string, chain: [string, number], extra: object) =>
    buildDesign({
      kind: 'pendant',
      archetype,
      title: 't',
      summary: 's',
      chain: { style: chain[0], lengthMm: 457, widthMm: chain[1] },
      ...extra,
    } as never)
  const halo = {
    stones: [
      { role: 'center', carat: 1 },
      { role: 'halo', widthMm: 1.3 },
    ],
  }
  it.each<[string, () => ReturnType<typeof buildDesign>]>([
    ['halo on 2 mm curb', () => recipe('halo', ['curb', 2], halo)],
    ['halo on 8 mm Cuban', () => recipe('halo', ['cuban', 8], halo)],
    ['halo on 1 mm box', () => recipe('halo', ['box', 1], halo)],
    [
      'solitaire with a pavé role',
      () =>
        recipe('pendantSolitaire', ['cable', 1.2], {
          stones: [
            { role: 'center', carat: 1 },
            { role: 'pave', widthMm: 1.3 },
          ],
        }),
    ],
    [
      'iced letter on 2 mm tennis',
      () =>
        recipe('icedPendant', ['tennis', 2], {
          body: { heightMm: 32, text: 'A', thicknessMm: 4, iceLevel: 1 },
          stones: [{ role: 'pave', widthMm: 1.3 }],
        }),
    ],
    [
      // A scooped-out back only 2.4 mm deep: the slot goes behind it, not into it.
      'iced 20 mm piece on 3 mm Cuban',
      () => recipe('icedPendant', ['cuban', 3], { body: { heightMm: 20, iceLevel: 1 } }),
    ],
  ])(
    'recipe %s evaluates at production with no errors and an honest bail',
    async (_, make) => {
      const e = await kernel.evaluate(make(), { detail: 'production' })
      const errors = e.diagnostics.filter((d) => d.level === 'error')
      expect(errors.map((d) => `${d.code}: ${d.message}`)).toEqual([])
      expect(e.diagnostics.map((d) => d.code)).not.toContain('bail.hiddenLow')
    },
    60_000,
  )

  it.each(['Olivia', 'Mia', 'Tej', 'Isabella'])(
    'hangs the name %s level from a bail on its metal, all one casting',
    async (text) => {
      const scene = await kernel.scene(name(text), { detail: 'production' })
      const codes = scene.evaluation.diagnostics
        .filter((d) => d.level !== 'info')
        .map((d) => d.code)
      expect(codes).not.toContain('metal.disconnected')
      expect(codes).not.toContain('outline.disconnected')
      expect(codes).not.toContain('chain.clash')
      expect(scene.evaluation.parts.filter((p) => p.nodeId !== 'chain')).toHaveLength(1)
      // The opening is over the name's centre of mass, or the nearest metal to it (a gap between
      // two letters can put that 1.5 mm away, about 14° off level on a 9 mm name).
      const body = scene.nodes.get('body')!.bodies[0]!.solid.triangles(scene.quality)
      let v = 0
      let cx = 0
      const p = body.positions
      for (let i = 0; i < body.indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => body.indices[i + k]! * 3) as [number, number, number]
        const d =
          p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
          p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
          p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)
        v += d
        cx += d * (p[a]! + p[b]! + p[c]!)
      }
      const opening = scene.nodes.get('bail')!.frames.opening!.origin
      expect(Math.abs(cx / (4 * v) - opening[0])).toBeLessThan(1.6)
    },
    60_000,
  )

  it('makes a loop bail’s hole as wide as it is high', async () => {
    const scene = await kernel.scene(
      designFrom('pendant', [
        { id: 'p', kind: 'primitive', shape: 'box', size: [10, 2, 10] },
        { id: 'bail', kind: 'bail', host: 'p', style: 'loop', opening: 5, wire: 1, width: 3 },
      ]),
    )
    const bail = scene.nodes.get('bail')!
    const hole = holeProfile(bail.bodies, bail.frames.opening!, scene.quality)!
    const { height, width } = clearSpan(hole)
    expect(height).toBeGreaterThan(4.6)
    expect(width).toBeGreaterThan(0.95 * height)
  })

  it.each<[string, NodeInput]>([
    [
      'the open top of a crown',
      {
        id: 'body',
        kind: 'meshBody',
        source: { type: 'builtin', name: 'crown' },
        height: 35,
        flatBack: 0.35,
      },
    ],
    [
      'the cleft of a heart',
      {
        id: 'body',
        kind: 'vectorBody',
        source: { type: 'shape', shape: 'heart' },
        height: 16,
        thickness: 1.6,
      },
    ],
  ])(
    'stands on metal over %s',
    async (_, body) => {
      for (const style of ['loop', 'tube', 'ring'] as const) {
        const scene = await kernel.scene(
          designFrom('pendant', [
            body,
            { id: 'bail', kind: 'bail', host: 'body', style, opening: 4 },
          ]),
          { detail: 'production' },
        )
        const codes = scene.evaluation.diagnostics.map((d) => d.code)
        expect(codes).not.toContain('metal.disconnected')
        expect(codes).not.toContain('bail.unsupported')
        expect(scene.evaluation.parts).toHaveLength(1)
      }
    },
    60_000,
  )

  it('says when nothing under the bail can carry it', async () => {
    // Two posts far apart: the bail's foot cannot reach either from the centre of mass, but it
    // walks out to one; with no metal at all near the top it reports.
    const e = await kernel.evaluate(
      designFrom('pendant', [
        {
          id: 'p',
          kind: 'primitive',
          shape: 'torus',
          size: [10, 10, 1],
          tube: 0.2,
          transform: { position: [0, 0, 0], rotation: [90, 0, 0], scale: 1 },
        },
        { id: 'bail', kind: 'bail', host: 'p', style: 'tube', opening: 4, width: 14 },
      ]),
    )
    expect(e.diagnostics.map((d) => d.code)).toContain('bail.unsupported')
  })

  it('closes a hidden bail on the piece’s back, and its fix clears the bail check in one step', async () => {
    let design = designFrom('pendant', [
      {
        id: 'body',
        kind: 'vectorBody',
        source: { type: 'shape', shape: 'heart' },
        height: 30,
        thickness: 2,
      },
      { id: 'bail', kind: 'bail', host: 'body', style: 'hidden', opening: 3, width: 3 },
      {
        id: 'c',
        kind: 'chain',
        style: 'cuban',
        linkWidth: 4,
        wire: 1,
        length: 457,
        through: 'bail',
      },
    ])
    const first = await kernel.evaluate(design, { detail: 'production' })
    const small = first.diagnostics.find((d) => d.code === 'bail.small')
    expect(small?.fix).toBeDefined()
    design = applyOps(design, small!.fix!.ops).design
    const fixed = await kernel.evaluate(design, { detail: 'production' })
    const codes = fixed.diagnostics.map((d) => d.code)
    expect(codes).not.toContain('bail.small')
    expect(codes).not.toContain('chain.clash')
    expect(codes).not.toContain('metal.disconnected')
  }, 60_000)

  it('offers, at draft, an opening that clears the bail check in one click', async () => {
    // A tube on the solitaire pendant over a 2 mm tennis line: the bisection's rounded size
    // used to fall 0.1 mm short at draft, where the tube's polygon is coarse.
    const design = applyOps(template('pendant-solitaire'), [
      { t: 'update', id: 'bail', patch: { style: 'tube', opening: 4, width: 3, wire: 1.1 } },
      { t: 'update', id: 'chain', patch: { style: 'tennis', linkWidth: 2, wire: 0.52 } },
    ]).design
    const first = await kernel.evaluate(design)
    const small = first.diagnostics.find((d) => d.code === 'bail.small')
    expect(small?.fix).toBeDefined()
    const fixed = await kernel.evaluate(applyOps(design, small!.fix!.ops).design)
    expect(fixed.diagnostics.map((d) => d.code)).not.toContain('bail.small')
  }, 60_000)

  it('warns when a hidden bail cannot hang a small piece face out', async () => {
    const e = await kernel.evaluate(
      designFrom('pendant', [
        {
          id: 'body',
          kind: 'vectorBody',
          source: { type: 'shape', shape: 'heart' },
          height: 8,
          thickness: 1.6,
        },
        { id: 'bail', kind: 'bail', host: 'body', style: 'hidden', opening: 4 },
      ]),
    )
    const low = e.diagnostics.find((d) => d.code === 'bail.hiddenLow')
    expect(low?.fix?.ops).toEqual([{ t: 'update', id: 'bail', patch: { style: 'tube' } }])
  })

  it.each<[string, NodeInput]>([
    [
      'flat-backed',
      {
        id: 'body',
        kind: 'meshBody',
        source: { type: 'builtin', name: 'crown' },
        height: 35,
        flatBack: 0.35,
      },
    ],
    [
      'hollowed',
      {
        id: 'body',
        kind: 'meshBody',
        source: { type: 'builtin', name: 'crown' },
        height: 35,
        flatBack: 0.5,
        hollow: 1.25,
      },
    ],
  ])(
    'says a hidden bail has nothing to lie in on a %s crown open at the back',
    async (_, body) => {
      const design = designFrom('pendant', [
        body,
        { id: 'bail', kind: 'bail', host: 'body', style: 'hidden', opening: 10, width: 5 },
      ])
      // Already at draft, the detail the studio works in, with the one-click way out.
      const draft = await kernel.evaluate(design)
      const unsupported = draft.diagnostics.find((d) => d.code === 'bail.unsupported')
      expect(unsupported?.fix?.ops).toEqual([{ t: 'update', id: 'bail', patch: { style: 'tube' } }])
      // Not "too small": the piece is 35 mm, the bail just has no back to lie in.
      expect(draft.diagnostics.map((d) => d.code)).not.toContain('bail.hiddenLow')
      // Production does not add "move it until it overlaps" for a node that places itself.
      const production = await kernel.evaluate(design, { detail: 'production' })
      const codes = production.diagnostics.map((d) => d.code)
      expect(codes).toContain('bail.unsupported')
      expect(codes).not.toContain('metal.disconnected')
      // The fix gives one casting.
      const fixed = await kernel.evaluate(applyOps(design, unsupported!.fix!.ops).design, {
        detail: 'production',
      })
      expect(fixed.diagnostics.map((d) => d.code)).not.toContain('metal.disconnected')
      expect(fixed.parts).toHaveLength(1)
    },
    60_000,
  )

  it('says when a solid pendant body is heavy, with a hollow for a sculpted one', async () => {
    const sculpt = (name: 'crown' | 'trophy', flatBack: number) =>
      designFrom('pendant', [
        { id: 'body', kind: 'meshBody', source: { type: 'builtin', name }, height: 35, flatBack },
        { id: 'bail', kind: 'bail', host: 'body', style: 'tube', opening: 6, width: 4 },
      ])
    const trophy = sculpt('trophy', 0.5)
    const solid = await kernel.evaluate(trophy)
    const heavy = solid.diagnostics.find((d) => d.code === 'body.heavy')!
    expect(heavy.level).toBe('warning')
    expect(heavy.value!).toBeGreaterThan(heavy.limit!)
    const hollowed = await kernel.evaluate(applyOps(trophy, heavy.fix!.ops).design)
    expect(hollowed.diagnostics.map((d) => d.code)).not.toContain('body.heavy')
    // Solid is decided from what was built: the crown's thin walls defeat the hollow, so it is
    // still cast solid, said so, and the same hollow is not offered again.
    const crown = sculpt('crown', 0.35)
    const crownHeavy = (await kernel.evaluate(crown)).diagnostics.find(
      (d) => d.code === 'body.heavy',
    )!
    const tried = await kernel.evaluate(applyOps(crown, crownHeavy.fix!.ops).design)
    const codes = tried.diagnostics.map((d) => d.code)
    if (codes.includes('mesh.hollowFailed')) {
      const still = tried.diagnostics.find((d) => d.code === 'body.heavy')!
      expect(still.message).toMatch(/hollow failed/)
      expect(still.fix).toBeUndefined()
    } else expect(codes).not.toContain('body.heavy')
    // Block letters 60 mm high: an outline body has no hollow yet, so no one-click fix, and
    // under 200 g only a note.
    const text = await kernel.evaluate(
      designFrom('pendant', [
        {
          id: 'body',
          kind: 'vectorBody',
          source: { type: 'text', text: 'KING', font: 'block' },
          height: 60,
          thickness: 4,
        },
        { id: 'bail', kind: 'bail', host: 'body', style: 'tube', opening: 6, width: 4 },
      ]),
    )
    const plate = text.diagnostics.find((d) => d.code === 'body.heavy')
    expect(plate?.fix).toBeUndefined()
    expect(plate?.level).toBe(plate!.value! > 200 ? 'warning' : 'info')
    expect(plate?.message).toMatch(/cannot be hollowed yet/)
    // A light piece says nothing.
    const light = await kernel.evaluate(name('Mia'))
    expect(light.diagnostics.map((d) => d.code)).not.toContain('body.heavy')
  }, 60_000)

  it('counts every body in front of a hidden bail, not only its host, as hiding it', async () => {
    // A pierced plate with a plug standing in the hole (a two-level initial): the bail hangs on
    // the plate, and the plug covers it. Read against the plate alone, the hole looked open.
    const plugged = (plug: boolean) =>
      designFrom('pendant', [
        {
          id: 'base',
          kind: 'vectorBody',
          source: { type: 'shape', shape: 'shield' },
          height: 40,
          thickness: 3,
        },
        {
          id: 'cutter',
          kind: 'vectorBody',
          source: { type: 'shape', shape: 'circle' },
          height: 12,
          thickness: 8,
          transform: { position: [0, 2, 8], rotation: [0, 0, 0], scale: 0.98 },
        },
        { id: 'field', kind: 'boolean', op: 'subtract', target: 'base', tools: ['cutter'] },
        ...(plug
          ? [
              {
                id: 'plug',
                kind: 'vectorBody',
                source: { type: 'shape', shape: 'circle' },
                height: 12,
                thickness: 3,
                transform: { position: [0, 0, 8], rotation: [0, 0, 0], scale: 1 },
              } as NodeInput,
            ]
          : []),
        { id: 'bail', kind: 'bail', host: 'field', style: 'hidden', opening: 6, width: 4, wire: 1.4 },
      ])
    const codes = async (plug: boolean) =>
      (await kernel.evaluate(plugged(plug))).diagnostics.map((d) => d.code)
    expect(await codes(true)).not.toContain('bail.showsThrough')
    // Without the plug the hole is open and the bail shows.
    expect(await codes(false)).toContain('bail.showsThrough')
  }, 60_000)

  it('hangs a hidden bail from the top rim of a scooped-out back', async () => {
    // The trophy hollowed with an open back: no back plate, but the cup's rim runs along the top.
    const e = await kernel.evaluate(
      designFrom('pendant', [
        {
          id: 'body',
          kind: 'meshBody',
          source: { type: 'builtin', name: 'trophy' },
          height: 45,
          flatBack: 0.5,
          hollow: 1.25,
        },
        { id: 'bail', kind: 'bail', host: 'body', style: 'hidden', opening: 10, width: 5 },
      ]),
      { detail: 'production' },
    )
    const codes = e.diagnostics.map((d) => d.code)
    expect(codes).not.toContain('bail.unsupported')
    expect(codes).not.toContain('metal.disconnected')
    expect(e.parts).toHaveLength(1)
  }, 60_000)

  it('says how far off level a name hangs when its bail cannot stand over the centre of mass', async () => {
    // "Tej": the nearest metal that carries the bail is 1.5 mm right of the centre of mass.
    const tej = await kernel.evaluate(name('Tej'))
    const off = tej.diagnostics.find((d) => d.code === 'bail.offLevel')
    expect(off?.level).toBe('warning')
    expect(off!.value!).toBeGreaterThan(off!.limit!)
    expect(off!.message).toMatch(/hangs turned about \d+°/)
    // A name with metal over its centre of mass hangs level and says nothing.
    const olivia = await kernel.evaluate(name('Olivia'))
    expect(olivia.diagnostics.map((d) => d.code)).not.toContain('bail.offLevel')
  }, 60_000)

  it('reports a chain that runs through the pendant, not only through the bail', async () => {
    // A ring bail sunk deep in a tall plate: the hung chain passes through the plate's top.
    const e = await kernel.evaluate(
      designFrom('pendant', [
        { id: 'p', kind: 'primitive', shape: 'box', size: [30, 2, 10] },
        {
          id: 'q',
          kind: 'primitive',
          shape: 'box',
          size: [4, 2, 4],
          transform: { position: [-9, 0, 7], rotation: [0, 0, 0], scale: 1 },
        },
        { id: 'u', kind: 'boolean', op: 'union', target: 'p', tools: ['q'] },
        { id: 'bail', kind: 'bail', host: 'u', style: 'ring', opening: 3 },
        {
          id: 'c',
          kind: 'chain',
          style: 'cable',
          linkWidth: 1.2,
          wire: 0.3,
          length: 400,
          through: 'bail',
          layout: 'straight',
        },
      ]),
      { detail: 'production' },
    )
    const clash = e.diagnostics.filter((d) => d.code === 'chain.clash')
    expect(clash.map((d) => d.message).join(' ')).toMatch(/through the pendant/)
  }, 60_000)
})
