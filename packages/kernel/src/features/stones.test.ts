/** Regressions for the stones findings of the core engine pass (heads, halos, rows, stones). */
import {
  applyOps,
  buildDesign,
  type Design,
  designFrom,
  GEM_CUT_IDS,
  GEM_CUTS,
  type GemCutId,
  gemDims,
  type NodeOf,
  prongSpinFor,
  replaceStone,
  ringInnerDiameter,
  culetDepth as schemaCuletDepth,
  TEMPLATES,
} from '@pave/schema'
import { afterAll, describe, expect, it } from 'vitest'
import type { Scene } from '../core'
import { unitContains } from '../gems/index'
import { clawLayoutIssues, prongDirections, stoneShape } from '../gems/shape'
import { toFrame } from '../geometry/vec'
import { createKernel } from '../kernel'
import { culetDepth } from './gem'
import type { HeadData } from './setting'

const kernel = createKernel()
afterAll(() => kernel.dispose())
const template = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
const update = (d: Design, id: string, patch: Record<string, unknown>) =>
  applyOps(d, [{ t: 'update', id, patch }]).design
const codes = async (d: Design, detail: 'draft' | 'production' = 'draft') =>
  (await kernel.evaluate(d, { detail })).diagnostics.map((x) => x.code)

describe('heads', () => {
  it('a long stone on a narrow band stands on a base rail: one casting, legs no steeper than 25°', async () => {
    // oval-pave has a 1.8 mm band; every cut at its longest ratio.
    for (const cut of GEM_CUT_IDS) {
      const d = update(template('oval-pave'), 'center', { cut, lw: GEM_CUTS[cut].lw.max })
      const scene = await kernel.scene(d, { detail: 'production' })
      const parts = scene.evaluation.parts
      expect(parts.length, cut).toBe(1)
      expect(
        scene.evaluation.diagnostics.map((x) => x.code),
        cut,
      ).not.toContain('metal.disconnected')
    }
    const scene = await kernel.scene(
      update(template('solitaire'), 'center', { cut: 'marquise', width: 6.44 }),
    )
    const stone = scene.stones[0]!.stone
    const head = scene.nodes.get('head')!
    const claws = (head.data as HeadData).claws
    // Each claw body: from its top at the girdle to its lowest point, measured in the stone's frame.
    for (const { solid } of head.bodies.slice(0, claws.length)) {
      const t = solid.triangles()
      let low = [0, 0, Infinity]
      let top = [0, 0, 0]
      let topN = 0
      for (let i = 0; i < t.positions.length; i += 3) {
        const p = [t.positions[i]!, t.positions[i + 1]!, t.positions[i + 2]!]
        const z = p[0]! * stone.frame.z[0] + p[1]! * stone.frame.z[1] + p[2]! * stone.frame.z[2]
        const z0 = stone.frame.origin.reduce((s, v, k) => s + v * stone.frame.z[k]!, 0)
        if (z - z0 < low[2]!) low = [p[0]!, p[1]!, z - z0]
        if (Math.abs(z - z0) < 0.15) {
          top = [top[0]! + p[0]!, top[1]! + p[1]!, 0]
          topN++
        }
      }
      const run = Math.hypot(top[0]! / topN - low[0]!, top[1]! / topN - low[1]!)
      expect((Math.atan2(run, -low[2]!) * 180) / Math.PI).toBeLessThan(27)
    }
  })

  it('oval-pavé × every cut at 5 ct: one casting, no seat cut through, open cathedral arms', async () => {
    const base = template('oval-pave')
    const before = (await kernel.evaluate(base)).report.metalMassG
    for (const cut of GEM_CUT_IDS) {
      const r = replaceStone(base, { nodeId: 'center' }, { cut, carat: 5 })
      const e = await kernel.evaluate(applyOps(base, r.ops).design, { detail: 'production' })
      expect(e.parts.length, cut).toBe(1)
      const codes = e.diagnostics.map((x) => x.code)
      expect(codes, cut).not.toContain('seat.through')
      expect(codes, cut).not.toContain('metal.disconnected')
      // The arms are a strip with the arch open under them: a 5 ct stone does not double the
      // band's weight.
      expect(e.report.metalMassG, cut).toBeLessThan(before * 1.6)
    }
  }, 120_000)

  it('a head of another alloy than its band is one casting of its own', async () => {
    const d = update(template('solitaire'), 'head', { material: 'au18k-yellow' })
    const e = await kernel.evaluate(d, { detail: 'production' })
    expect(e.parts.map((p) => p.material).sort()).toEqual(['au18k-yellow', 'pt950'])
  })

  it('claws are symmetric left to right for every count the shape allows', () => {
    const stone = (cut: (typeof GEM_CUT_IDS)[number]) =>
      stoneShape({
        cut,
        stone: 'diamond',
        dims: gemDims(cut, 6),
        frame: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
        role: 'center',
        setting: 'prong',
      })
    // A marquise's two points leave no gap that is its own mirror, so it takes even counts.
    const counts = {
      round: [4, 5, 6, 8],
      oval: [4, 5, 6, 8],
      cushion: [4, 5, 6, 8],
      radiant: [4, 5, 6, 8],
      marquise: [4, 6, 8],
      pear: [4, 5, 6, 8],
    }
    for (const [cut, ns] of Object.entries(counts) as [keyof typeof counts, number[]][])
      for (const n of ns) {
        const shape = stone(cut)
        const dirs = prongDirections(shape, n, (prongSpinFor(n) * Math.PI) / 180)
        expect(clawLayoutIssues(shape, dirs), `${cut} ${n}`).toEqual([])
      }
    // A trillion with 4 claws, a princess with 3, a heart with a claw in its cleft: reported.
    expect(clawLayoutIssues(stone('trillion'), prongDirections(stone('trillion'), 4, 0))).toContain(
      'a claw sits in the middle of a side',
    )
    expect(
      clawLayoutIssues(stone('princess'), prongDirections(stone('princess'), 3, 0))[0],
    ).toMatch(/left without a claw/)
    expect(clawLayoutIssues(stone('heart'), prongDirections(stone('heart'), 4, 0))).toContain(
      'a claw sits in the cleft',
    )
  })

  it('reports a claw count that leaves a point bare, with a reset to the usual count', async () => {
    const d = update(update(template('solitaire'), 'center', { cut: 'trillion' }), 'head', {
      prongCount: 4,
    })
    const e = await kernel.evaluate(d)
    const p = e.diagnostics.find((x) => x.code === 'prong.count')!
    expect(p.fix?.ops).toEqual([{ t: 'update', id: 'head', patch: { prongCount: null } }])
  })

  it('blames a pinned rotation, not the count, when the count is right and the spin is not', async () => {
    const d = update(update(template('solitaire'), 'center', { width: 8.2 }), 'head', {
      prongCount: 6,
      prongSpin: 45,
    })
    const p = (await kernel.evaluate(d)).diagnostics.find((x) => x.code === 'prong.count')!
    expect(p.message).toMatch(/turned 45°; 0° lays 6 out symmetrically/)
    expect(p.fix?.ops).toEqual([{ t: 'update', id: 'head', patch: { prongSpin: null } }])
  })

  it('reports claws far too heavy or light for the stone, with a reset to auto', async () => {
    const small = update(update(template('solitaire'), 'center', { width: 3.86 }), 'head', {
      prongDiameter: 1.4,
    })
    expect(await codes(small)).toContain('prong.heavy')
    const big = update(update(template('solitaire'), 'center', { width: 12 }), 'head', {
      prongDiameter: 0.8,
    })
    expect(await codes(big)).toContain('prong.light')
    expect(await codes(template('solitaire'))).not.toContain('prong.light')
  })

  it('a long stone’s rails stay clear of its pavilion: no seat cuts a rail off or shaves it thin', async () => {
    // A stud's basket rail round a 5 ct baguette at lw 5 was cut clean off at both ends.
    const studs = template('studs')
    const long = replaceStone(studs, { nodeId: 'stone' }, { cut: 'baguette', carat: 5, lw: 5 })
    const e = await kernel.evaluate(applyOps(studs, long.ops).design, { detail: 'production' })
    expect(e.diagnostics.filter((x) => x.level === 'error').map((x) => x.code)).toEqual([])
    // A princess at its longest ratio keeps its base rail whole, at every head that holds it.
    for (const id of ['solitaire', 'three-stone', 'halo']) {
      const base = template(id)
      const r = replaceStone(base, { nodeId: 'center' }, { cut: 'princess', carat: 5, lw: 1.1 })
      const p = await kernel.evaluate(applyOps(base, r.ops).design, { detail: 'production' })
      expect(
        p.diagnostics.filter((x) => x.level === 'error').map((x) => x.code),
        id,
      ).toEqual([])
    }
  }, 120_000)

  it('a half bezel holds the points of a pointed stone', async () => {
    const d = update(update(template('solitaire'), 'head', { style: 'halfBezel' }), 'center', {
      cut: 'marquise',
      width: 6.44,
    })
    const scene = await kernel.scene(d, { detail: 'production' })
    const stone = scene.stones[0]!.stone
    const head = scene.nodes.get('head')!
    // Both arcs reach the tips along the stone's length (world Y on a ring).
    const reach = Math.max(...head.bodies.map((b) => Math.abs(b.solid.bounds().max[1])))
    expect(reach).toBeGreaterThan(stone.dims.length / 2)
    expect(scene.evaluation.parts).toHaveLength(1)
  })

  it('a flush head on a stone standing clear of any body is an error with a bezel fix', async () => {
    const e = await kernel.evaluate(update(template('solitaire'), 'head', { style: 'flush' }))
    const d = e.diagnostics.find((x) => x.code === 'setting.noHost')!
    expect(d.level).toBe('error')
    expect(d.fix?.ops).toEqual([{ t: 'update', id: 'head', patch: { style: 'bezel' } }])
  })
})

describe('stones', () => {
  it('the kernel culet depth equals the schema’s for every cut', () => {
    for (const cut of GEM_CUT_IDS) {
      const dims = gemDims(cut, 6.5)
      expect(Math.abs(culetDepth(cut, dims) - schemaCuletDepth(cut, dims)), cut).toBeLessThan(0.02)
    }
  })

  it('a cabochon on a band rests on its surface, not inside the metal', async () => {
    const d = update(template('solitaire'), 'center', { cut: 'cabochon' })
    const scene = await kernel.scene(d)
    const m = scene.evaluation.stones[0]!.matrix
    const band = d.nodes.band as NodeOf<'ringShank'>
    const outer = ringInnerDiameter(band.size) / 2 + band.thicknessTop
    expect(
      Math.hypot(m[12]!, m[14]!) - culetDepth('cabochon', scene.stones[0]!.stone.dims),
    ).toBeGreaterThanOrEqual(outer - 0.01)
  })

  it('a large cabochon centre’s claws stay out of the side stones of a three-stone', async () => {
    const base = template('three-stone')
    const r = replaceStone(base, { nodeId: 'center' }, { cut: 'cabochon', carat: 5 })
    const scene = await kernel.scene(applyOps(base, r.ops).design)
    for (const id of ['side1', 'side2']) {
      const side = scene.nodes.get(id)!.stones[0]!
      const shape = stoneShape(side)
      let inside = 0
      for (const { solid } of scene.nodes.get('head')!.bodies) {
        const t = solid.triangles()
        for (let i = 0; i < t.positions.length; i += 3) {
          const [x, y, z] = toFrame(side.frame, [
            t.positions[i]!,
            t.positions[i + 1]!,
            t.positions[i + 2]!,
          ])
          if (unitContains(shape.unit, [x / shape.sx, y / shape.sy, z / shape.sz])) inside++
        }
      }
      expect(inside, id).toBe(0)
    }
  })

  it('a pair of studs that a large stone would fuse into one casting is offered the spacing to part it', async () => {
    const studs = template('studs')
    const r = replaceStone(studs, { nodeId: 'stone' }, { cut: 'trillion', carat: 5 })
    const fused = await kernel.evaluate(applyOps(studs, r.ops).design, { detail: 'production' })
    expect(fused.parts).toHaveLength(1)
    const w = r.warnings.find((x) => x.code === 'pair.touch')!
    expect(w.nodeId).toBe('stone')
    const parted = applyOps(studs, [...r.ops, ...w.suggestion!.ops]).design
    expect((await kernel.evaluate(parted, { detail: 'production' })).parts).toHaveLength(2)
    // A stone the pair already has room for is not warned about.
    const small = replaceStone(studs, { nodeId: 'stone' }, { cut: 'trillion', carat: 3 })
    expect(small.warnings.map((x) => x.code)).not.toContain('pair.touch')
  }, 60_000)

  it('an unusable measured size falls back to the nominal stone with a warning', async () => {
    // Bypass the schema's bounds, as a raw stored record would.
    const base = template('solitaire')
    const g = base.nodes.center as NodeOf<'gem'>
    const d: Design = {
      ...base,
      nodes: {
        ...base.nodes,
        center: {
          ...g,
          sourcing: { provider: 'x', sku: 'y', measured: { length: 0, width: 0, depth: 0 } },
        },
      },
    }
    const e = await kernel.evaluate(d)
    expect(e.diagnostics.map((x) => x.code)).toContain('stone.measured')
    expect(e.report.caratTotal).toBeGreaterThan(0.9)
    expect(e.report.metalMassG).toBeGreaterThan(0)
  })
})

describe('halo and rows', () => {
  it('halo stones never collide, for any centre cut (the heart’s cleft included)', async () => {
    const scene = await kernel.scene(template('halo'))
    const claws = (scene.nodes.get('head')!.data as HeadData).claws
    expect(claws).toHaveLength(4)
    // No halo stone collides with the centre for any cut (the heart's cleft included).
    for (const cut of GEM_CUT_IDS) {
      const e = await kernel.evaluate(update(template('halo'), 'center', { cut }))
      expect(
        e.diagnostics.filter((x) => x.code === 'stone.overlap'),
        cut,
      ).toEqual([])
    }
  })

  it('the halo template is a frame, not a tyre: built at its gap, claws in notches, face as the canon reckons it', async () => {
    const design = template('halo')
    const scene = await kernel.scene(design, { detail: 'production' })
    const e = scene.evaluation
    const centre = scene.nodes.get('center')!.stones[0]!
    const node = design.nodes.halo as NodeOf<'halo'>
    const layout = haloLayout(scene)
    // The inner row stands at the node's gap to the centre stone, not beyond the claws.
    expect(Math.min(...layout.toGirdle)).toBeCloseTo(node.offset, 1)
    // Every claw stands in a notch between two halo stones; elsewhere the stones run evenly.
    expect(layout.notches).toBe(4)
    // A run may take one stone more, drawn together to no less than the kernel's 0.05 mm, when
    // that is nearer the asked gap than spreading: the 1.1 mm template's long runs take five.
    expect(Math.min(...layout.plain)).toBeGreaterThanOrEqual(0.05)
    expect(Math.max(...layout.plain)).toBeLessThanOrEqual(0.4)
    // Face across the halo: the centre, the gap, the stones and the 0.45 mm border each side.
    const expected = centre.dims.width + 2 * (node.offset + node.stoneWidth + 0.45)
    expect(layout.face).toBeCloseTo(expected, 1)
    // Canon `halo.outline`: 1.4–1.6× the centre.
    expect(layout.face / centre.dims.width).toBeLessThanOrEqual(1.6)
    const bad = e.diagnostics.filter(
      (x) =>
        x.nodeId === 'halo' && ['stone.inMetal', 'seat.wall', 'stone.overlap'].includes(x.code),
    )
    expect(bad).toEqual([])
    expect(e.parts).toHaveLength(1)
    // The gap field is the gap built: a wider gap moves the inner row out with it.
    const wider = await kernel.scene(update(design, 'halo', { offset: 0.45 }))
    expect(Math.min(...haloLayout(wider).toGirdle)).toBeCloseTo(0.45, 1)
  }, 60_000)

  it('halo rows stay continuous over centre sizes and cuts: no gap past 0.4 mm but at a claw', async () => {
    const base = template('halo')
    const cuts = ['cushion', 'princess', 'asscher', 'round', 'oval', 'pear', 'heart', 'trillion']
    for (const cut of cuts as GemCutId[])
      for (const carat of [0.3, 1, 2, 5]) {
        const r = replaceStone(base, { nodeId: 'center' }, { cut, carat })
        const scene = await kernel.scene(applyOps(base, r.ops).design)
        const { plain, notches, claws, notchSlack, toGirdle } = haloLayout(scene)
        // The heart's cleft too: a stone sits in its V, or the two beside it close up across it.
        expect(Math.max(...plain), `${cut} ${carat} ct`).toBeLessThanOrEqual(0.4)
        // Claws stand in notches, or the row steps out round a claw on a sharp point.
        expect(notches, `${cut} ${carat} ct`).toBeLessThanOrEqual(claws)
        // A claw fills its notch but for a little air either side.
        expect(Math.max(0, ...notchSlack), `${cut} ${carat} ct notch`).toBeLessThanOrEqual(0.4)
        // Stepping out round corner claws does not carry whole sides off the girdle (the
        // princess's 0.6–1 mm moat): the row hugs the sides.
        if (cut === 'princess' || cut === 'trillion')
          expect(Math.min(...toGirdle), `${cut} ${carat} ct`).toBeLessThan(0.3)
      }
    // A square bezel head has no claws to notch round: the count keeps four-fold symmetry where
    // that does not space the stones out (or crowd them), two-fold where it would.
    for (const cut of ['princess', 'asscher', 'cushion'] as const)
      for (const carat of [0.3, 0.75, 1, 2]) {
        const r = replaceStone(base, { nodeId: 'center' }, { cut, carat })
        const d = update(applyOps(base, r.ops).design, 'head', { style: 'bezel' })
        const { plain, stones } = haloLayout(await kernel.scene(d))
        expect(stones % 2, `${cut} ${carat} ct bezel`).toBe(0)
        expect(Math.min(...plain), `${cut} ${carat} ct bezel`).toBeGreaterThanOrEqual(0.05)
        expect(Math.max(...plain), `${cut} ${carat} ct bezel`).toBeLessThanOrEqual(0.4)
      }
  }, 120_000)

  it('halo stones keep their seat wall at production, the heart included, from 0.3 to 5 ct', async () => {
    const base = template('halo')
    const cases: [GemCutId, number, number?][] = [
      ['heart', 2],
      ['heart', 3],
      ['heart', 4],
      ['heart', 5],
      ['cushion', 0.3],
      ['princess', 0.3],
      ['round', 0.3],
      ['oval', 5],
      ['emerald', 5],
      // A flat back has no pavilion for the inner edge to tuck under.
      ['cabochon', 0.3],
      ['cabochon', 1],
      ['cabochon', 5],
      // A long heart's pavilion narrows slowest under its lobes.
      ['heart', 2, 1.1],
      ['heart', 5, 1.1],
    ]
    for (const [cut, carat, lw] of cases) {
      const r = replaceStone(base, { nodeId: 'center' }, { cut, carat, ...(lw ? { lw } : {}) })
      const e = await kernel.evaluate(applyOps(base, r.ops).design, { detail: 'production' })
      expect(
        e.diagnostics.filter(
          (x) =>
            x.nodeId === 'halo' &&
            ['seat.wall', 'stone.inMetal', 'stone.overlap', 'seat.through'].includes(x.code),
        ),
        `${cut} ${carat} ct${lw ? ` lw ${lw}` : ''}`,
      ).toEqual([])
    }
  }, 360_000)

  it('every centre cut at 5 ct in the halo is free of stone.inMetal errors at production', async () => {
    const base = template('halo')
    for (const cut of GEM_CUT_IDS) {
      const r = replaceStone(base, { nodeId: 'center' }, { cut, carat: 5 })
      const e = await kernel.evaluate(applyOps(base, r.ops).design, { detail: 'production' })
      expect(
        e.diagnostics.filter((x) => x.code === 'stone.inMetal' || x.code === 'stone.overlap'),
        cut,
      ).toEqual([])
      expect(e.parts.length, cut).toBe(1)
    }
  }, 120_000)

  it('a halo on a small centre stands on posts on the band, so a head of another alloy leaves it one casting with the band', async () => {
    const small = update(template('halo'), 'center', { cut: 'round', width: 3.66 })
    const scene = await kernel.scene(small)
    expect(scene.nodes.get('halo')!.bodies.length).toBeGreaterThan(1)
    const twoAlloy = update(template('halo'), 'head', { material: 'pt950' })
    const e = await kernel.evaluate(twoAlloy, { detail: 'production' })
    expect(e.diagnostics.map((x) => x.code)).not.toContain('metal.disconnected')
  }, 60_000)

  it('a halo saved before claw clearance keeps its stones, and is offered the clear layout', async () => {
    // A piece saved then, with the 1.3 mm melee the template had.
    const v1 = {
      ...update(template('halo'), 'halo', { stoneWidth: 1.3 }),
      schemaVersion: 1,
    } as Design
    const old = await kernel.scene(v1)
    const fix = old.evaluation.diagnostics.find((x) => x.code === 'halo.claws')!
    expect(fix.fix?.ops).toEqual([{ t: 'update', id: 'halo', patch: { clearClaws: true } }])
    // The old layout: stones evenly round at the stored gap, as the version-1 kernel built them.
    const centre = old.nodes.get('center')!.stones[0]!
    const halo = old.nodes.get('halo')!.stones
    const shape = stoneShape(centre)
    expect(halo.length).toBe(16)
    for (const s of halo) {
      const local = s.frame.origin.map((v, k) => v - centre.frame.origin[k]!)
      const x = local.reduce((a, v, k) => a + v * centre.frame.x[k]!, 0)
      const y = local.reduce((a, v, k) => a + v * centre.frame.y[k]!, 0)
      // On the path 0.25 mm + half a stone off the girdle.
      const d = Math.min(
        ...shape.offsetPath(0.25 + 0.65).map(([px, py]) => Math.hypot(px - x, py - y)),
      )
      expect(d).toBeLessThan(0.2)
    }
  })

  it('the halo and eternity templates ship with their rows’ seat walls', async () => {
    // Melee and bands sized for 0.4 mm of metal each side of the row. (Oval-pavé is still open.)
    for (const id of ['halo', 'eternity']) {
      const e = await kernel.evaluate(template(id), { detail: 'production' })
      expect(
        e.diagnostics.filter((x) => x.level !== 'info').map((x) => `${x.code}@${x.nodeId}`),
        id,
      ).toEqual([])
    }
  }, 60_000)

  it('pavé on a domed band keeps its seat wall: stones off the crest sink until the metal stands above their girdles', async () => {
    for (const [band, stone] of [
      [3, 1.5],
      [2.5, 1.5],
      [4, 2.5],
    ] as const) {
      const d = designFrom('ring', [
        { id: 'band', kind: 'ringShank', widthTop: band, widthBottom: band, profile: 'court' },
        { id: 'row', kind: 'gemRow', host: 'band', stoneWidth: stone, coverage: 120 },
      ])
      expect(await codes(d, 'production'), `${stone} on ${band}`).not.toContain('seat.wall')
    }
  }, 120_000)

  it('a row graduating to exactly 1.5 mm graduates, and its end stones are the size asked', async () => {
    const d = designFrom('ring', [
      { id: 'band', kind: 'ringShank', widthTop: 3, widthBottom: 3 },
      { id: 'row', kind: 'gemRow', host: 'band', stoneWidth: 2.5, graduateTo: 1.5, coverage: 150 },
    ])
    const widths = (await kernel.evaluate(d)).stones.map((s) => s.dims.width)
    expect(Math.min(...widths)).toBeCloseTo(1.5, 6)
    expect(Math.max(...widths)).toBeCloseTo(2.5, 6)
  })

  it('pavé end stones get a pair of beads beyond them; shared claws lap both girdles', async () => {
    const row = (setting: string, profile = 'flat') =>
      designFrom('ring', [
        { id: 'band', kind: 'ringShank', widthTop: 3, widthBottom: 3, profile },
        { id: 'row', kind: 'gemRow', host: 'band', stoneWidth: 1.5, coverage: 60, setting },
      ] as never)
    const pave = await kernel.scene(row('pave'), { detail: 'production' })
    const stones = pave.stones.length
    // Two beads in each of the n − 1 gaps, and two beyond each end.
    expect(pave.nodes.get('row')!.additions).toHaveLength(2 * (stones - 1) + 4)
    const shared = await kernel.scene(row('sharedProng', 'court'))
    const claws = shared.nodes.get('row')!.additions.map((a) => a.solid.bounds())
    const centres = shared.stones.map((s) => s.stone.frame.origin)
    // Every claw comes within the prong overlap of its two nearest girdles.
    for (const b of claws) {
      const c = [0, 1, 2].map((k) => (b.min[k]! + b.max[k]!) / 2)
      const r = (b.max[0]! - b.min[0]! + b.max[1]! - b.min[1]!) / 4
      const near = centres
        .map((o) => Math.hypot(o[0] - c[0]!, o[1] - c[1]!) - 0.75 - r)
        .sort((x, y) => x - y)
      expect(near[0]!).toBeLessThan(0.02)
    }
    // On the domed court band every claw, the end ones included, reaches over the girdle of
    // the stone nearest it: some point of it is inside the girdle, above the girdle plane.
    for (const add of shared.nodes.get('row')!.additions) {
      const t = add.solid.triangles()
      const pts = Array.from(
        { length: t.positions.length / 3 },
        (_, i) => [t.positions[3 * i]!, t.positions[3 * i + 1]!, t.positions[3 * i + 2]!] as const,
      )
      const c = pts[0]!
      const nearest = shared.stones.reduce((a, s) =>
        Math.hypot(...s.stone.frame.origin.map((v, k) => v - c[k]!)) <
        Math.hypot(...a.stone.frame.origin.map((v, k) => v - c[k]!))
          ? s
          : a,
      )
      const laps = pts.some((p) => {
        const [x, y, z] = toFrame(nearest.stone.frame, [p[0], p[1], p[2]])
        return Math.hypot(x, y) < nearest.stone.dims.width / 2 - 0.02 && z > 0
      })
      expect(laps).toBe(true)
    }
  })
})

/**
 * A halo as a setter sees it: each halo stone's plan distance from the centre's girdle, the
 * gaps between neighbours (split into those a claw stands in and the rest), and the face
 * across the ring.
 */
function haloLayout(scene: Scene) {
  const centre = scene.nodes.get('center')!.stones[0]!
  const shape = stoneShape(centre)
  const halo = scene.nodes.get('halo')!
  const stones = halo.stones
  const local = (p: readonly number[]) => toFrame(centre.frame, p as [number, number, number])
  const girdle = shape.polygon(16).points
  const toGirdle = stones.map((s) => {
    const [x, y] = local(s.frame.origin)
    const d = Math.min(...girdle.map(([gx, gy]) => Math.hypot(gx - x, gy - y)))
    return d - Math.max(s.dims.width, s.dims.length) / 2
  })
  const claws = ((scene.nodes.get('head')?.data as HeadData | undefined)?.claws ?? []).map((c) => {
    const g = shape.point(c.phi)
    const n = shape.normal(c.phi)
    const off = c.reach - c.radius
    return [g[0] + n[0] * off, g[1] + n[1] * off] as const
  })
  const head = scene.nodes.get('head')
  const clawWidth = Math.max(
    0,
    ...((head?.data as HeadData | undefined)?.claws ?? []).map((c) => 2 * c.halfWidth),
  )
  const plain: number[] = []
  const notchSlack: number[] = []
  let notches = 0
  stones.forEach((s, i) => {
    const a = local(s.frame.origin)
    const b = local(stones[(i + 1) % stones.length]!.frame.origin)
    const gap = Math.hypot(a[0] - b[0], a[1] - b[1]) - Math.max(s.dims.width, s.dims.length)
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const half = Math.hypot(a[0] - b[0], a[1] - b[1]) / 2
    if (claws.some(([x, y]) => Math.hypot(x - mid[0]!, y - mid[1]!) < half)) {
      notches++
      // Bare metal either side of the claw standing in the notch.
      notchSlack.push((gap - clawWidth) / 2)
    } else plain.push(gap)
  })
  const pts = halo.bodies.flatMap((b) => {
    const p = b.solid.triangles().positions
    return Array.from({ length: p.length / 3 }, (_, k) =>
      local([p[k * 3]!, p[k * 3 + 1]!, p[k * 3 + 2]!]),
    )
  })
  const xs = pts.map((p) => p[0])
  const face = Math.max(...xs) - Math.min(...xs)
  return {
    toGirdle,
    plain,
    notches,
    notchSlack,
    claws: claws.length,
    stones: stones.length,
    face,
  }
}
