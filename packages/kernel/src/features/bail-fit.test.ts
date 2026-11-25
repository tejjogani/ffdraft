/**
 * How a bail fits the piece it hangs: it keeps clear of the stones set in its host, its loop's
 * legs stay inside a thin plate, a hidden loop on a scooped back is held at both ends, and the
 * recipe's bail is one the kernel accepts across iced names, text and trophies.
 */
import { applyOps, buildDesign, designFrom, type PieceSpecInput } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Scene } from '../core'
import { createKernel, type LocalKernel } from '../kernel'
import { QUALITY } from '../solid/solid'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

const T = { title: 't', summary: 's' }
const halo = (style: string, widthMm: number) =>
  buildDesign({
    ...T,
    kind: 'pendant',
    archetype: 'halo',
    stones: [
      { role: 'center', carat: 1 },
      { role: 'halo', widthMm: 1.3 },
    ],
    chain: { style, lengthMm: 457, widthMm },
  } as PieceSpecInput)

/**
 * Share of a stone's girdle disc hidden behind the bail's metal, seen from its table: rays from
 * far out along the stone's axis back to just in front of the girdle, against the bail alone.
 */
function hiddenShare(scene: Scene, stone: Scene['stones'][number]['stone']): number {
  const meshes = scene.nodes.get('bail')!.bodies.map((b) => b.solid.manifold(QUALITY.draft))
  const { origin: o, x: u, y: v, z: n } = stone.frame
  const r = stone.dims.width / 2
  let total = 0
  let hidden = 0
  for (let i = -10; i <= 10; i++)
    for (let j = -10; j <= 10; j++) {
      if (i * i + j * j > 100) continue
      total++
      const at = (k: number, along: number) =>
        o[k]! + (i / 10) * r * u[k]! + (j / 10) * r * v[k]! + along * n[k]!
      const from: [number, number, number] = [at(0, 20), at(1, 20), at(2, 20)]
      const to: [number, number, number] = [at(0, 0.05), at(1, 0.05), at(2, 0.05)]
      if (meshes.some((m) => m.rayCast(from, to).length > 0)) hidden++
    }
  return hidden / total
}

/** A round plate `thickness` thick hung from a bail of the given style, opening and wire. */
const plate = (thickness: number, style: string, opening: number, wire: number) =>
  designFrom('pendant', [
    {
      id: 'body',
      kind: 'vectorBody',
      source: { type: 'shape', shape: 'circle' },
      height: 20,
      thickness,
    },
    { id: 'bail', kind: 'bail', host: 'body', style, opening, wire, width: 3 },
  ] as never)

describe('bail fit', () => {
  it.each<[string, number]>([
    ['cable', 1.2],
    ['curb', 2],
    ['cuban', 8],
  ])(
    'hangs a halo pendant on %s %s mm without hiding any halo stone',
    async (style, width) => {
      const scene = await kernel.scene(halo(style, width), { detail: 'production' })
      const stones = scene.stones.filter((s) => s.instance.nodeId === 'halo')
      expect(stones.length).toBeGreaterThan(10)
      // The top stones, where the bail stands, measured one by one: none is behind its metal
      // (the tube's foot hid 59 % of the 12 o'clock stone on 2 mm curb, 71 % on 8 mm Cuban).
      const top = [...stones].sort((a, b) => b.stone.frame.origin[2] - a.stone.frame.origin[2])
      for (const s of top.slice(0, 5)) expect(hiddenShare(scene, s.stone)).toBeLessThan(0.02)
      const codes = scene.evaluation.diagnostics.map((d) => d.code)
      expect(codes).not.toContain('bail.coversStone')
      expect(codes).not.toContain('stone.inMetal')
      expect(scene.evaluation.diagnostics.filter((d) => d.level === 'error')).toEqual([])
    },
    120_000,
  )

  it('says when a bail stands across stones it cannot keep clear of', async () => {
    // A halo lying face up: its stones look up at the bail standing on them, and there is no
    // girdle plane in front of the piece to move behind.
    const e = await kernel.evaluate(
      designFrom('pendant', [
        { id: 'center', kind: 'gem', cut: 'round', width: 5 },
        { id: 'head', kind: 'setting', gem: 'center', style: 'basket' },
        { id: 'halo', kind: 'halo', around: 'center', cut: 'round', stoneWidth: 1.3 },
        { id: 'bail', kind: 'bail', host: 'halo', style: 'tube', opening: 4, width: 3 },
      ]),
    )
    const covers = e.diagnostics.find((d) => d.code === 'bail.coversStone')
    expect(covers?.level).toBe('warning')
    expect(covers!.value!).toBeGreaterThan(covers!.limit!)
    expect(covers!.related!.every((id) => id.startsWith('halo:'))).toBe(true)
  }, 60_000)

  it('keeps a loop bail’s legs inside a 1.6 mm plate at every opening and wire', async () => {
    // Small openings and heavy wire curled one leg out through the plate's face as a feathered
    // tongue (wall.thin 0.023 mm at a 3.5 mm opening).
    const found: string[] = []
    for (const opening of [3, 3.5, 4.5, 6, 8, 10])
      for (const wire of [0.8, 1.1, 1.5]) {
        const e = await kernel.evaluate(
          designFrom('pendant', [
            {
              id: 'body',
              kind: 'vectorBody',
              source: { type: 'shape', shape: 'circle' },
              height: 20,
              thickness: 1.6,
            },
            { id: 'bail', kind: 'bail', host: 'body', style: 'loop', opening, wire, width: 3 },
          ]),
          { detail: 'production' },
        )
        for (const d of e.diagnostics)
          if (d.level === 'error' || d.code === 'metal.disconnected')
            found.push(`o${opening} w${wire}: ${d.code} ${d.value ?? ''}`)
      }
    expect(found).toEqual([])
  }, 180_000)

  it.each<[string, () => ReturnType<typeof buildDesign>]>([
    ['ring on a 2 mm disc', () => plate(2, 'ring', 3.2, 1.36)],
    ['tube on a 1.6 mm disc', () => plate(1.6, 'tube', 6, 1.2)],
    [
      'ring on an iced 45 mm KING',
      () =>
        buildDesign({
          ...T,
          kind: 'pendant',
          archetype: 'icedPendant',
          body: { heightMm: 45, text: 'KING', thicknessMm: 3, iceLevel: 1 },
          stones: [{ role: 'pave', widthMm: 1.3 }],
        } as PieceSpecInput),
    ],
  ])(
    'keeps a %s inside the plate where it meets the top',
    async (_, make) => {
      // The sunk arc of a ring or tube is wider than a thin plate where it meets the top: it
      // stood 1–1.5 mm proud of both faces, and on an iced KING buried the top stones 59 % in
      // metal. Now it stands on a stem and its arc meets the top no wider than the plate.
      const design = make()
      const scene = await kernel.scene(design)
      const body = scene.nodes.get('body')!.bodies[0]!.solid
      const box = body.bounds()
      const opening = scene.nodes.get('bail')!.frames.opening!.origin
      const mid = (box.min[1] + box.max[1]) / 2
      const hits = body
        .manifold(QUALITY.draft)
        .rayCast([opening[0], mid, box.max[2] + 5], [opening[0], mid, box.min[2] - 5])
      const top = Math.max(...hits.map((h) => h.position[2]!))
      // Bail metal in the millimetre under the top, sampled across the plate's thickness.
      const bail = scene.nodes.get('bail')!.bodies.map((b) => b.solid.manifold(QUALITY.draft))
      let lo = Infinity
      let hi = -Infinity
      for (let dz = 0.05; dz < 1; dz += 0.1)
        for (let dx = -0.5; dx <= 0.5; dx += 0.25)
          for (const m of bail)
            for (const h of m.rayCast(
              [opening[0] + dx, box.min[1] - 5, top - dz],
              [opening[0] + dx, box.max[1] + 5, top - dz],
            )) {
              lo = Math.min(lo, h.position[1]!)
              hi = Math.max(hi, h.position[1]!)
            }
      expect(lo).toBeGreaterThanOrEqual(box.min[1] - 0.05)
      expect(hi).toBeLessThanOrEqual(box.max[1] + 0.05)
      if (design.nodes.ice) {
        const production = await kernel.evaluate(design, { detail: 'production' })
        expect(production.diagnostics.map((d) => d.code)).not.toContain('stone.inMetal')
      }
    },
    120_000,
  )

  const trophy = (heightMm: number) =>
    buildDesign({
      ...T,
      kind: 'pendant',
      archetype: 'icedPendant',
      body: { heightMm, iceLevel: 1 },
      stones: [{ role: 'pave', widthMm: 1.3 }],
    } as PieceSpecInput)

  it.each([25, 45, 100])(
    'holds a hidden bail on a %s mm scooped trophy at both ends of its back run',
    async (heightMm) => {
      const design = trophy(heightMm)
      expect((design.nodes.bail as { style: string }).style).toBe('hidden')
      const draft = await kernel.scene(design)
      // The loop's metal that overlaps the body: a good share of a full lap of the back run (a
      // solid back gives about 0.7 of one), where the rim alone gave 12–18 %.
      const bail = draft.nodes.get('bail')!.bodies.map((b) => b.solid.manifold(QUALITY.draft))
      const body = draft.nodes.get('body')!.bodies[0]!.solid.manifold(QUALITY.draft)
      const joint = bail.reduce((sum, m) => sum + m.intersect(body).volume(), 0)
      const node = design.nodes.bail as { wire: number; width: number; opening: number }
      const lap = node.wire * node.width * (node.opening + node.wire)
      expect(joint).toBeGreaterThan(0.3 * lap)
      const e = await kernel.evaluate(design, { detail: 'production' })
      const codes = e.diagnostics.map((d) => d.code)
      for (const code of ['wall.thin', 'bail.unsupported', 'bail.weakJoint', 'metal.disconnected'])
        expect(codes).not.toContain(code)
    },
    300_000,
  )

  it('says when a scooped back has no metal below to strap a hidden loop to', async () => {
    // A plate scooped from the back all the way down: only its 3 mm top rim meets the loop.
    const e = await kernel.evaluate(
      designFrom('pendant', [
        { id: 'p', kind: 'primitive', shape: 'box', size: [20, 4, 30] },
        {
          id: 'cut',
          kind: 'primitive',
          shape: 'box',
          size: [16, 4, 40],
          transform: { position: [0, 1.5, -8], rotation: [0, 0, 0], scale: 1 },
        },
        { id: 'scoop', kind: 'boolean', op: 'subtract', target: 'p', tools: ['cut'] },
        { id: 'bail', kind: 'bail', host: 'scoop', style: 'hidden', opening: 5, width: 3 },
      ]),
    )
    const weak = e.diagnostics.find((d) => d.code === 'bail.weakJoint')
    expect(weak?.level).toBe('warning')
    expect(weak?.fix?.ops).toEqual([{ t: 'update', id: 'bail', patch: { style: 'tube' } }])
  }, 60_000)

  it('says when a hidden loop over an open back is cast into the piece only at its ends', async () => {
    // A 16 mm trophy scooped from the back: its loop's runs touch the rim and the metal under
    // the scoop, but the neck below is too thin to strap to (a tenth of a lap, said nothing).
    const e = await kernel.evaluate(
      designFrom('pendant', [
        {
          id: 'body',
          kind: 'meshBody',
          source: { type: 'builtin', name: 'trophy' },
          height: 16,
          flatBack: 0.5,
          hollow: 1.25,
        },
        {
          id: 'bail',
          kind: 'bail',
          host: 'body',
          style: 'hidden',
          opening: 5,
          width: 2.5,
          wire: 1.2,
        },
      ]),
    )
    const weak = e.diagnostics.find((d) => d.code === 'bail.weakJoint')
    expect(weak?.level).toBe('warning')
    expect(weak!.value!).toBeLessThan(weak!.limit!)
    expect(weak?.message).toMatch(/less than a wire's length of its back run/)
    expect(weak?.fix?.ops).toEqual([{ t: 'update', id: 'bail', patch: { style: 'tube' } }])
  }, 60_000)

  it('levels a short name by standing its letters on a bar', async () => {
    const jo = buildDesign({
      ...T,
      kind: 'pendant',
      archetype: 'namePendant',
      body: { heightMm: 9, text: 'Jo' },
      chain: { style: 'cable', lengthMm: 406, widthMm: 1.2 },
    } as PieceSpecInput)
    const off = (await kernel.evaluate(jo)).diagnostics.find((d) => d.code === 'bail.offLevel')!
    expect(off.fix?.ops).toEqual([{ t: 'update', id: 'body', patch: { join: 'underline' } }])
    const barred = await kernel.evaluate(applyOps(jo, off.fix!.ops).design)
    expect(barred.diagnostics.map((d) => d.code)).not.toContain('bail.offLevel')
  }, 60_000)

  // The recipe's bail across iced names and text (the top over a word's centre of mass is a
  // lowercase letter or a dip between letters, not the body's height) and trophies: one the
  // kernel accepts, at draft. An iced name of 14 mm and up comes out iced.
  const rows: [string, PieceSpecInput][] = []
  for (const h of [14, 20, 30])
    for (const text of ['Tej', 'Amara', 'Isabella'])
      rows.push([
        `iced name ${text} ${h} mm`,
        {
          ...T,
          kind: 'pendant',
          archetype: 'namePendant',
          body: { heightMm: h, text, thicknessMm: 2.5 },
          stones: [{ role: 'pave', widthMm: 1.1 }],
          ...(h === 14 ? { chain: { style: 'curb', lengthMm: 457, widthMm: 2 } } : {}),
        } as PieceSpecInput,
      ])
  for (const h of [20, 30])
    rows.push([
      `iced text BOSS ${h} mm`,
      {
        ...T,
        kind: 'pendant',
        archetype: 'icedPendant',
        body: { heightMm: h, text: 'BOSS', thicknessMm: 3, iceLevel: 1 },
        stones: [{ role: 'pave', widthMm: 1.3 }],
      } as PieceSpecInput,
    ])
  for (const h of [20, 45, 100, 150, 200])
    rows.push([
      `iced trophy ${h} mm`,
      {
        ...T,
        kind: 'pendant',
        archetype: 'icedPendant',
        body: { heightMm: h, iceLevel: 1 },
        stones: [{ role: 'pave', widthMm: 1.3 }],
      } as PieceSpecInput,
    ])
  it('gives iced names, text and trophies a bail the kernel accepts', async () => {
    const found: string[] = []
    for (const [label, spec] of rows) {
      const e = await kernel.evaluate(buildDesign(spec))
      for (const d of e.diagnostics)
        if (['bail.unsupported', 'bail.hiddenLow', 'bail.weakJoint'].includes(d.code))
          found.push(`${label}: ${d.code}`)
      if (label.startsWith('iced name') && e.stones.length === 0) found.push(`${label}: no stones`)
      kernel.dispose()
    }
    expect(found).toEqual([])
  }, 600_000)
})
