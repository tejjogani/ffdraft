/**
 * Stone replacement keeps the mount (docs/plans/targeted-edits.md §8): every centre-stone
 * template × every cut × three sizes at draft, through the intent and as a plain update of the
 * gem, plus a production sample. The kernel evaluates the resolved design, so claws, wire, side
 * stones, shoulders and the shoulder row follow the new stone.
 */
import {
  applyOps,
  buildDesign,
  cathedralPeak,
  culetDepth,
  type Design,
  flatBacked,
  GEM_CUT_IDS,
  type GemCutId,
  gemDimsFromCarat,
  MOUNT,
  type NodeOf,
  prongCountFor,
  replaceStone,
  resolveDesign,
  ringInnerDiameter,
  stoneDims,
  TEMPLATES,
} from '@pave/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { gemUnit } from '../gems/index'
import { createKernel } from '../kernel'
import { RULES } from '../rules'
import type { HeadData } from './setting'

const kernel = createKernel()
afterAll(() => kernel.dispose())

const template = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
const CENTRE: Record<string, string> = {
  solitaire: 'center',
  'oval-pave': 'center',
  halo: 'center',
  'three-stone': 'center',
  'pendant-solitaire': 'center',
  studs: 'stone',
}

/** The geometric asserts of plan §8 on one evaluated case. */
async function expectMounted(design: Design, gemId: string, label: string, haloWidth?: number) {
  const scene = await kernel.scene(design)
  const e = scene.evaluation
  for (const [id, r] of scene.nodes) expect(r.status, `${label}: ${id}`).toBe('ok')
  expect(
    e.diagnostics.filter((d) => d.level === 'error').map((d) => `${d.code}@${d.nodeId}`),
    label,
  ).toEqual([])
  const r = resolveDesign(design)
  const g = r.nodes[gemId] as NodeOf<'gem'>
  const dims = stoneDims(g)
  const head = Object.values(r.nodes).find(
    (n): n is NodeOf<'setting'> => n.kind === 'setting' && n.gem === gemId,
  )!
  if (head.style === 'prong' || head.style === 'basket') {
    const claws = (scene.nodes.get(head.id)!.data as HeadData).claws
    expect(claws.length, `${label}: claw count`).toBe(prongCountFor(g.cut, dims))
    // A V-claw on every point of the outline.
    const points = gemUnit(g.cut, dims.length / dims.width).outline.prongs.filter((p) => p.point)
    expect(claws.filter((c) => c.point).length, `${label}: V-claws`).toBe(points.length)
  }
  const band = r.nodes.band as NodeOf<'ringShank'> | undefined
  if (band && g.placement.type === 'ringTop') {
    const m = e.stones.find((s) => s.nodeId === gemId)!.matrix
    const girdle = Math.hypot(m[12]!, m[14]!)
    const inner = ringInnerDiameter(band.size) / 2
    const outer = inner + band.thicknessTop
    expect(girdle - culetDepth(g.cut, dims) - inner, `${label}: culet`).toBeGreaterThanOrEqual(
      RULES.culetClearance - 1e-6,
    )
    if (flatBacked(g.cut)) expect(girdle, `${label}: on the band`).toBeGreaterThanOrEqual(outer)
    if (band.shoulder === 'cathedral') {
      const { peak } = cathedralPeak(band.shoulderHeight!, outer)
      const under = girdle - (outer + band.shoulderHeight!) * Math.cos(peak)
      // Arches peak just under the girdle (a cabochon sits too low for the least rise), up to
      // the rule's cap on the rise: above it the head's legs carry a large stone the rest.
      if (band.shoulderHeight! < MOUNT.shoulderAutoMax - 1e-9)
        expect(under, `${label}: arches`).toBeLessThanOrEqual(0.5)
      expect(under, `${label}: arches`).toBeGreaterThanOrEqual(flatBacked(g.cut) ? -0.2 : 0)
    }
  }
  if (haloWidth !== undefined) {
    const halo = e.stones.filter((s) => s.nodeId === 'halo')
    expect(halo.length, `${label}: halo`).toBeGreaterThanOrEqual(6)
    for (const s of halo) expect(s.dims.width).toBe(haloWidth)
  }
}

describe('replace the centre stone and the mount follows (draft)', () => {
  for (const [tid, gemId] of Object.entries(CENTRE))
    it(`${tid}: 13 cuts × 0.5, 1.5 and 4 ct through design.replaceStone`, async () => {
      const base = template(tid)
      const halo = base.nodes.halo as NodeOf<'halo'> | undefined
      for (const cut of GEM_CUT_IDS as GemCutId[])
        for (const carat of [0.5, 1.5, 4]) {
          const r = replaceStone(base, { nodeId: gemId }, { cut, carat })
          await expectMounted(
            applyOps(base, r.ops).design,
            gemId,
            `${tid} ${cut} ${carat} ct`,
            halo?.stoneWidth,
          )
        }
    }, 120_000)

  for (const [tid, gemId] of Object.entries(CENTRE))
    it(`${tid}: a plain update of cut and width gives the same mount`, async () => {
      const base = template(tid)
      const halo = base.nodes.halo as NodeOf<'halo'> | undefined
      for (const cut of GEM_CUT_IDS as GemCutId[])
        for (const carat of [0.5, 1.5, 4]) {
          const width = Number(gemDimsFromCarat(cut, carat).width.toFixed(2))
          const design = applyOps(base, [
            { t: 'update', id: gemId, patch: { cut, width, lw: null } },
          ]).design
          await expectMounted(design, gemId, `${tid} ${cut} ${carat} ct (update)`, halo?.stoneWidth)
        }
    }, 120_000)
})

describe('replace the centre stone (production sample)', () => {
  it('cuts a new seat and rebuilds the head from both measured candidates', async () => {
    let design = template('solitaire')
    for (const { sku, measured, claws } of [
      { sku: 'A', measured: { length: 7.34, width: 7.29, depth: 4.3 }, claws: 4 },
      { sku: 'B', measured: { length: 7.57, width: 7.52, depth: 4.59 }, claws: 6 },
    ]) {
      const fit = { provider: 'diaex', sku, measured }
      design = applyOps(design, replaceStone(design, { nodeId: 'center' }, { fit }).ops).design
      const scene = await kernel.scene(design, { detail: 'production' })
      expect(scene.evaluation.stones).toHaveLength(1)
      expect(scene.evaluation.stones[0]?.dims).toEqual(measured)
      const head = scene.nodes.get('head')!
      expect(head.status).toBe('ok')
      expect((head.data as HeadData).claws).toHaveLength(claws)
      const cutter = scene.nodes.get('center')!.cuts[0]!
      const { min, max } = cutter.solid.bounds()
      expect(max[0] - min[0]).toBeCloseTo(measured.width * RULES.seatScale, 2)
      expect(max[1] - min[1]).toBeCloseTo(measured.length * RULES.seatScale, 2)
      expect(max[2] - min[2]).toBeCloseTo(measured.depth, 2)
      expect(scene.evaluation.diagnostics.filter((d) => d.level === 'error')).toEqual([])
    }
  }, 120_000)

  it('one casting per alloy, for every template with round, princess, pear and emerald', async () => {
    for (const [tid, gemId] of Object.entries(CENTRE))
      for (const cut of ['round', 'princess', 'pear', 'emerald'] as const) {
        const base = template(tid)
        const design = applyOps(
          base,
          replaceStone(base, { nodeId: gemId }, { cut, carat: 1.5 }).ops,
        ).design
        const e = await kernel.evaluate(design, { detail: 'production' })
        // A chain is its own part (it is never fused to the piece it carries).
        const parts = e.parts.filter((p) => design.nodes[p.nodeId]?.kind !== 'chain')
        // Studs are a pair: two castings.
        const pieces = tid === 'studs' ? 2 : 1
        expect(parts.length, `${tid} ${cut}`).toBe(
          pieces * new Set(parts.map((p) => p.material)).size,
        )
        expect(
          e.diagnostics.filter((d) => d.code === 'metal.disconnected' || d.code === 'seat.through'),
          `${tid} ${cut}`,
        ).toEqual([])
      }
  }, 600_000)
})
