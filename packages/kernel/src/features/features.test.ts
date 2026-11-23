import { GEM_CUT_IDS, NODE_SCHEMAS, type NodeKind, designFrom } from '@pave/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { Evaluator } from '../evaluate/evaluate'
import { BASES, coreEvaluator, evaluate, failures, variant } from '../testing/core'
import type { Evaluation } from '../types'

let evaluator: Evaluator
beforeAll(async () => {
  evaluator = await coreEvaluator()
})

interface Field {
  name: string
  values: unknown[]
}

/** The tunable fields of a node kind, from its JSON schema: numbers (min/max) and choices. */
function fields(kind: string): Field[] {
  const schema = z.toJSONSchema(NODE_SCHEMAS[kind as NodeKind], { io: 'input' }) as {
    properties: Record<string, { type?: string; minimum?: number; maximum?: number; enum?: unknown[] }>
  }
  const out: Field[] = []
  for (const [name, p] of Object.entries(schema.properties)) {
    if (['id', 'kind', 'name', 'material', 'finish', 'plating', 'stone'].includes(name)) continue
    if (p.enum) out.push({ name, values: p.enum })
    else if ((p.type === 'number' || p.type === 'integer') && p.minimum !== undefined && p.maximum !== undefined)
      out.push({ name, values: [p.minimum, p.maximum] })
    else if (p.type === 'boolean') out.push({ name, values: [true, false] })
  }
  return out
}

/** Deterministic pseudo-random numbers (mulberry32) so a failing fuzz case can be replayed. */
function random(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function expectSound(e: Evaluation, label: string): void {
  expect(failures(e), label).toEqual([])
  for (const part of e.parts) {
    expect(part.volumeMm3, `${label}: volume of ${part.id}`).toBeGreaterThan(0)
    expect(part.mesh.indices.length, `${label}: triangles of ${part.id}`).toBeGreaterThan(0)
    expect(Number.isFinite(part.bounds.max[0] - part.bounds.min[0])).toBe(true)
  }
  for (const stone of e.stones) expect(stone.matrix.every(Number.isFinite), `${label}: stone matrix`).toBe(true)
}

const KINDS = Object.keys(BASES)

describe('every feature builds across its parameter ranges', () => {
  it.each(KINDS)('%s: default, and each field at its minimum, maximum and every choice', async (kind) => {
    expectSound(await evaluate(evaluator, variant(kind, {})), `${kind} default`)
    expectSound(await evaluate(evaluator, variant(kind, {}), 'production'), `${kind} default (production)`)
    for (const field of fields(kind))
      for (const value of field.values) {
        const label = `${kind}.${field.name} = ${String(value)}`
        expectSound(await evaluate(evaluator, variant(kind, { [field.name]: value })), label)
      }
  })

  it.each(KINDS)('%s: random valid parameters (fuzz)', async (kind) => {
    const next = random(KINDS.indexOf(kind) + 1)
    const all = fields(kind)
    for (let round = 0; round < 25; round++) {
      const patch: Record<string, unknown> = {}
      for (const field of all) {
        if (next() < 0.35) continue
        const [lo, hi] = field.values as [number, number]
        patch[field.name] =
          typeof lo === 'number' && field.values.length === 2
            ? Number.isInteger(lo) && Number.isInteger(hi) && hi - lo <= 200 && field.name !== 'angle'
              ? Math.round(lo + next() * (hi - lo))
              : lo + next() * (hi - lo)
            : field.values[Math.floor(next() * field.values.length)]
      }
      // One in five rounds also runs at production detail (seats, beads, fusing).
      const detail = round % 5 === 0 ? 'production' : 'draft'
      expectSound(await evaluate(evaluator, variant(kind, patch), detail), `${kind} fuzz #${round} ${JSON.stringify(patch)}`)
    }
  })
})

describe('stones and settings', () => {
  it.each(GEM_CUT_IDS)('%s: every setting style holds it, on a ring and free-standing', async (cut) => {
    for (const style of ['prong', 'basket', 'bezel', 'halfBezel', 'flush'] as const) {
      const onRing = variant('setting', { style })
      onRing.nodes.stone = { ...onRing.nodes.stone, cut } as never
      for (const detail of ['draft', 'production'] as const) expectSound(await evaluate(evaluator, onRing, detail), `${cut} ${style}`)
      const e = await evaluate(evaluator, onRing, 'production')
      // A head on a band fuses with it into one castable body.
      if (style !== 'flush') expect(e.parts.length, `${cut} ${style} fuses with the band`).toBe(1)
    }
    const halo = variant('halo', {})
    halo.nodes.stone = { ...halo.nodes.stone, cut } as never
    const e = await evaluate(evaluator, halo, 'production')
    expectSound(e, `${cut} halo`)
    expect(e.diagnostics.filter((d) => d.code === 'stone.overlap'), `${cut} halo stones do not collide`).toEqual([])
  })

  it('claws grip the stone: each overlaps the girdle and reaches over the crown', async () => {
    const scene = await evaluator.scene(variant('setting', { prongCount: 4 }))
    const stone = scene.stones[0]!.stone
    const head = scene.nodes.get('node')!
    expect(head.bodies).toHaveLength(4)
    for (const { solid } of head.bodies) {
      const b = solid.bounds()
      const girdleZ = stone.frame.origin[2]
      // Above the girdle…
      expect(b.max[2]).toBeGreaterThan(girdleZ + 0.4)
      // …rooted in the band below it…
      expect(b.min[2]).toBeLessThan(girdleZ - stone.dims.depth * 0.5)
      // …and its nearest point to the stone's axis is inside the girdle radius.
      const tris = solid.triangles()
      let nearest = Infinity
      for (let i = 0; i < tris.positions.length; i += 3)
        if (tris.positions[i + 2]! > girdleZ) nearest = Math.min(nearest, Math.hypot(tris.positions[i]!, tris.positions[i + 1]!))
      expect(nearest).toBeLessThan(stone.dims.width / 2 - 0.1)
    }
  })

  it('gem rows derive their count from size, gap and coverage', async () => {
    const half = await evaluate(evaluator, variant('gemRow', { stoneWidth: 1.5, gap: 0.15, coverage: 180 }))
    const full = await evaluate(evaluator, variant('gemRow', { stoneWidth: 1.5, gap: 0.15, coverage: 360 }))
    // Girdles sit at ≈ 9.8 mm radius: a half round carries 18–19 stones, a full one twice that.
    expect(half.stones.length).toBeGreaterThanOrEqual(17)
    expect(half.stones.length).toBeLessThanOrEqual(19)
    expect(full.stones.length).toBeGreaterThanOrEqual(36)
    expect(full.stones.length).toBeLessThanOrEqual(38)
    const skipped = await evaluate(evaluator, variant('gemRow', { coverage: 150, skipCenter: 44 }))
    expect(skipped.stones.length % 2).toBe(0)
    const rows = await evaluate(evaluator, variant('gemRow', { rows: 3, stoneWidth: 0.8, coverage: 90 }))
    expect(rows.stones.length % 3).toBe(0)
    expect(rows.report.lots).toHaveLength(1)
  })

  it('reports problems it can compute, with fixes where they are unambiguous', async () => {
    const thin = await evaluate(evaluator, variant('ringShank', { thicknessTop: 1.2, thicknessBottom: 1 }))
    const shank = thin.diagnostics.find((d) => d.code === 'shank.thin')!
    expect(shank.fix?.ops[0]).toMatchObject({ t: 'update', id: 'band', patch: { thicknessBottom: 1.5 } })

    const fine = await evaluate(evaluator, variant('setting', { prongDiameter: 0.5 }))
    expect(fine.diagnostics.find((d) => d.code === 'prong.small')?.fix?.label).toMatch(/0\.85 mm/)

    const low = variant('gem', {})
    low.nodes.stone = { ...low.nodes.stone, placement: { type: 'ringTop', shank: 'band', angle: 0, elevation: 0.05, spin: 0 } } as never
    expect((await evaluate(evaluator, low)).diagnostics.map((d) => d.code)).toContain('culet.low')

    const wide = await evaluate(evaluator, variant('gemRow', { stoneWidth: 4 }))
    expect(wide.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['stone.wide', 'culet.low']))

    const twice = designFrom('other', [
      { id: 'a', kind: 'gem' },
      { id: 'b', kind: 'gem', transform: { position: [2, 0, 0], rotation: [0, 0, 0], scale: 1 } },
      { id: 'c', kind: 'gem', transform: { position: [20, 0, 0], rotation: [0, 0, 0], scale: 1 } },
    ])
    expect((await evaluate(evaluator, twice)).diagnostics.filter((d) => d.code === 'stone.overlap')).toHaveLength(1)
  })
})
