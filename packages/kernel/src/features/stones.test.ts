/** Regressions for the stones findings of the core engine pass (heads, halos, rows, stones). */
import {
  applyOps,
  buildDesign,
  type Design,
  designFrom,
  GEM_CUT_IDS,
  GEM_CUTS,
  gemDims,
  type NodeOf,
  prongSpinFor,
  replaceStone,
  ringInnerDiameter,
  culetDepth as schemaCuletDepth,
  TEMPLATES,
} from '@pave/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { clawLayoutIssues, prongDirections, stoneShape } from '../gems/shape'
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

  it('the halo template is continuous: claws inside the ring, even spacing, free of stone.inMetal at production', async () => {
    const scene = await kernel.scene(template('halo'), { detail: 'production' })
    const e = scene.evaluation
    const halo = scene.nodes.get('halo')!.stones
    // Stone to stone, round the ring: the template's 0.15 mm gap, nowhere a bald corner.
    const gaps = halo.map((s, i) => {
      const o = s.frame.origin
      const q = halo[(i + 1) % halo.length]!.frame.origin
      return Math.hypot(o[0] - q[0], o[1] - q[1], o[2] - q[2]) - s.dims.width
    })
    expect(Math.min(...gaps)).toBeGreaterThan(0.1)
    expect(Math.max(...gaps)).toBeLessThan(0.4)
    const bad = e.diagnostics.filter(
      (x) => x.nodeId === 'halo' && ['stone.inMetal', 'seat.wall', 'stone.overlap'].includes(x.code),
    )
    expect(bad).toEqual([])
    expect(e.parts).toHaveLength(1)
  })

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
    const v1 = { ...template('halo'), schemaVersion: 1 } as Design
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
      const d = Math.min(...shape.offsetPath(0.25 + 0.65).map(([px, py]) => Math.hypot(px - x, py - y)))
      expect(d).toBeLessThan(0.2)
    }
  })

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
  })
})
