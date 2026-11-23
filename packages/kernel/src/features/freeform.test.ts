/**
 * Freeform bodies (meshBody, vectorBody, relief) and automatic pavé, end to end through the
 * kernel: every body is a closed manifold with positive volume across the parameter ranges,
 * pavé layouts keep their spacing, sizes, region and margin, seats remove metal at production,
 * and identical input gives identical output.
 */
import {
  MELEE_SIZES_MM,
  type NodeInput,
  type NodeInputOf,
  TEMPLATES,
  buildDesign,
  designFrom,
} from '@pave/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { type LocalKernel, createKernel } from '../kernel'
import { OutlineDistance } from '../mesh/outline/distance'
import type { PaveField } from '../mesh/pave/region'
import { seededRandom } from '../mesh/random'
import { edgeTopology } from '../mesh/topology'
import { invertSimilarity, transformPoint } from '../geometry/vec'
import { meshVolume } from '../solid/meshing'
import { QUALITY } from '../solid/solid'
import type { StoneInstance } from '../types'

const kernel: LocalKernel = createKernel()
afterAll(() => kernel.dispose())

const pendant = (...nodes: NodeInput[]) => designFrom('pendant', nodes)

/** Builds one body node and checks it is a single closed, outward manifold with volume. */
async function expectSolid(node: NodeInput): Promise<number> {
  const scene = await kernel.scene(pendant(node))
  const result = scene.nodes.get(node.id)!
  const failure = result.diagnostics.find((d) => d.level === 'error')
  expect(failure?.message, JSON.stringify(node)).toBeUndefined()
  expect(result.status).toBe('ok')
  expect(result.bodies.length).toBe(1)
  const tris = result.bodies[0]!.solid.triangles(QUALITY.draft)
  const topology = edgeTopology(tris)
  expect(topology.open, 'open edges').toBe(0)
  expect(topology.nonManifold, 'non-manifold edges').toBe(0)
  expect(topology.inconsistent, 'inconsistent winding').toBe(0)
  const volume = meshVolume(tris)
  expect(volume).toBeGreaterThan(0)
  return volume
}

type VectorInput = NodeInputOf<'vectorBody'>
type ReliefInput = NodeInputOf<'relief'>
type MeshInput = NodeInputOf<'meshBody'>

describe('vectorBody', () => {
  const shapes = ['circle', 'oval', 'heart', 'star', 'cross', 'shield', 'hexagon', 'teardrop', 'tag'] as const
  const bevels = ['flat', 'chamfer', 'round', 'pillow'] as const

  it('builds every named shape with every edge treatment', async () => {
    for (const [i, shape] of shapes.entries())
      await expectSolid({
        id: 'v',
        kind: 'vectorBody',
        source: { type: 'shape', shape },
        bevel: bevels[i % bevels.length],
        bevelSize: 0.6,
        border: i % 3 === 0 ? 0.8 : 0,
      } satisfies VectorInput)
  })

  it('stays solid at the ends of its parameter ranges and under a seeded fuzz', async () => {
    const random = seededRandom(7)
    const cases: VectorInput[] = [
      { id: 'v', kind: 'vectorBody', source: { type: 'shape', shape: 'heart' }, height: 3, thickness: 0.6, bevel: 'round', bevelSize: 0 },
      { id: 'v', kind: 'vectorBody', source: { type: 'shape', shape: 'star' }, height: 150, thickness: 20, bevel: 'pillow', bevelSize: 5, border: 3 },
      { id: 'v', kind: 'vectorBody', source: { type: 'shape', shape: 'cross' }, height: 3, thickness: 20, bevel: 'chamfer', bevelSize: 5 },
    ]
    for (let k = 0; k < 4; k++)
      cases.push({
        id: 'v',
        kind: 'vectorBody',
        source: { type: 'shape', shape: shapes[Math.floor(random() * shapes.length)]! },
        height: 3 + random() * 60,
        thickness: 0.6 + random() * 8,
        bevel: bevels[Math.floor(random() * bevels.length)]!,
        bevelSize: random() * 2,
        border: random() < 0.5 ? 0 : random() * 1.5,
      })
    for (const c of cases) await expectSolid(c)
  })

  it('reads full SVG path grammar, scaled to the requested height', async () => {
    // Arcs, relative commands, smooth curves, compact numbers and a hole.
    const d = 'M10 0a10 10 0 1 1-.01 0zM10 5c3 0 5 2 5 5s-2 5-5 5-5-2-5-5 2-5 5-5z M20,8 h4 v4 h-4 Z'
    await expectSolid({ id: 'v', kind: 'vectorBody', source: { type: 'svg', d }, height: 20, bevel: 'flat' })
    const e = await kernel.evaluate(pendant({ id: 'v', kind: 'vectorBody', source: { type: 'svg', d }, height: 20, bevel: 'flat' }))
    const b = e.parts[0]!.bounds
    expect(b.max[2] - b.min[2]).toBeCloseTo(20, 2)
    expect(b.max[1]).toBeCloseTo(0, 6)
    expect(b.min[1]).toBeCloseTo(-2, 6)
    // The small square is a separate piece.
    expect(e.diagnostics.map((x) => x.code)).toContain('outline.disconnected')
  })

  it('turns block text into one solid and publishes the field inside its border', async () => {
    const node: VectorInput = {
      id: 'v',
      kind: 'vectorBody',
      source: { type: 'text', text: 'A', font: 'block' },
      height: 32,
      thickness: 4,
      bevel: 'pillow',
      bevelSize: 0.8,
      border: 0.6,
    }
    await expectSolid(node)
    const scene = await kernel.scene(pendant(node))
    const field = (scene.nodes.get('v')!.data as { paveField?: PaveField }).paveField
    expect(field?.outline.length).toBeGreaterThan(1) // outer contour and the counter of the A
  })
})

describe('relief', () => {
  it('builds every outline, with and without a rim, at the range ends', async () => {
    const outlines = ['round', 'oval', 'cushion', 'rect', 'shield'] as const
    for (const [i, outline] of outlines.entries())
      await expectSolid({ id: 'r', kind: 'relief', outline, rim: i % 2 ? 0 : 0.8, invert: i === 2 } satisfies ReliefInput)
    await expectSolid({ id: 'r', kind: 'relief', width: 4, height: 4, baseThickness: 0.5, depth: 0.1, rim: 0 })
    await expectSolid({ id: 'r', kind: 'relief', outline: 'rect', width: 100, height: 60, baseThickness: 6, depth: 6, rim: 4 })
  })
})

describe('meshBody', () => {
  it('builds the built-in models, honouring height, flat back, hollow and smoothing', async () => {
    for (const name of ['trophy', 'crown', 'dice'] as const) {
      await expectSolid({ id: 'm', kind: 'meshBody', source: { type: 'builtin', name } })
      const e = await kernel.evaluate(pendant({ id: 'm', kind: 'meshBody', source: { type: 'builtin', name }, height: 30 }))
      const b = e.parts[0]!.bounds
      expect(b.max[2] - b.min[2]).toBeCloseTo(30, 3)
      expect(b.max[1]).toBeCloseTo(0, 6)
    }
    const solid = await expectSolid({ id: 'm', kind: 'meshBody', source: { type: 'builtin', name: 'trophy' }, height: 40, flatBack: 0.35 })
    const hollow = await expectSolid({ id: 'm', kind: 'meshBody', source: { type: 'builtin', name: 'trophy' }, height: 40, flatBack: 0.35, hollow: 1 })
    expect(hollow).toBeLessThan(solid * 0.8)
    await expectSolid({ id: 'm', kind: 'meshBody', source: { type: 'builtin', name: 'dice' }, height: 3, smooth: 8, detail: 0.02 })
    await expectSolid({ id: 'm', kind: 'meshBody', source: { type: 'builtin', name: 'crown' }, height: 200, flatBack: 0.9 } satisfies MeshInput)
  })
})

// ── Pavé ─────────────────────────────────────────────────────────────────────────────────────

interface PaveCase {
  design: ReturnType<typeof pendant>
  pave: NodeInputOf<'pave'>
}

function iced(body: NodeInput, pave: Partial<NodeInputOf<'pave'>> = {}): PaveCase {
  const node: NodeInputOf<'pave'> = { id: 'ice', kind: 'pave', host: body.id, sizeMax: 1.6, sizeMin: 1, ...pave }
  return { design: pendant(body, node), pave: node }
}

const centre = (s: StoneInstance): [number, number, number] => [s.matrix[12]!, s.matrix[13]!, s.matrix[14]!]

function expectSpacing(stones: readonly StoneInstance[], gap: number): void {
  for (let i = 0; i < stones.length; i++)
    for (let j = i + 1; j < stones.length; j++) {
      const a = centre(stones[i]!)
      const b = centre(stones[j]!)
      const min = (stones[i]!.dims.width + stones[j]!.dims.width) / 2 + gap
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThanOrEqual(min - 1e-6)
    }
}

function expectStockSizes(stones: readonly StoneInstance[], min: number, max: number): void {
  for (const s of stones) {
    expect(MELEE_SIZES_MM as readonly number[]).toContain(s.dims.width)
    expect(s.dims.width).toBeGreaterThanOrEqual(min - 1e-9)
    expect(s.dims.width).toBeLessThanOrEqual(max + 1e-9)
    expect(s.role).toBe('melee')
    expect(s.setting).toBe('pave')
  }
}

describe('pave', () => {
  const heart: NodeInput = {
    id: 'body',
    kind: 'vectorBody',
    source: { type: 'shape', shape: 'heart' },
    height: 24,
    thickness: 3.5,
    bevel: 'pillow',
    bevelSize: 0.8,
    border: 0.8,
  }

  it('fills a bordered field with stock stones, spaced, inside the field and its margin', async () => {
    const c = iced(heart, { sizeMax: 1.5, sizeMin: 1, gap: 0.2, margin: 0.35 })
    const scene = await kernel.scene(c.design)
    const stones = scene.evaluation.stones.filter((s) => s.nodeId === 'ice')
    expect(stones.length).toBeGreaterThan(80)
    expectSpacing(stones, 0.2)
    expectStockSizes(stones, 1, 1.5)
    const host = scene.nodes.get('body')!
    const field = new OutlineDistance((host.data as { paveField: PaveField }).paveField.outline)
    const toLocal = invertSimilarity(host.matrix)
    for (const s of stones) {
      const [x, , z] = transformPoint(toLocal, centre(s))
      expect(field.inside(x, z)).toBe(true)
      expect(field.distance(x, z)).toBeGreaterThanOrEqual(s.dims.width / 2 + 0.35 - 0.02)
    }
    // Honeycomb: most stones are the largest size, with six neighbours inside the field.
    const largest = stones.filter((s) => s.dims.width === 1.5).length
    expect(largest / stones.length).toBeGreaterThan(0.8)
  })

  it('covers only the faces within the requested angle of the direction', async () => {
    const trophy: NodeInput = { id: 'body', kind: 'meshBody', source: { type: 'builtin', name: 'trophy' }, height: 45, flatBack: 0.35 }
    const c = iced(trophy, { sizeMax: 1.8, sizeMin: 1, region: { type: 'facing', direction: [0, -1, 0], maxAngle: 60 } })
    const scene = await kernel.scene(c.design)
    const stones = scene.evaluation.stones.filter((s) => s.nodeId === 'ice')
    expect(stones.length).toBeGreaterThan(100)
    expectSpacing(stones, 0.2)
    expectStockSizes(stones, 1, 1.8)
    // Each stone's table faces the viewer within the cone (plus the normal smoothing).
    for (const s of stones) {
      const z = [s.matrix[8]!, s.matrix[9]!, s.matrix[10]!]
      const len = Math.hypot(z[0]!, z[1]!, z[2]!)
      expect(-z[1]! / len).toBeGreaterThan(Math.cos((65 * Math.PI) / 180))
    }
  })

  it('lowers the ice level by shrinking the field without moving stones', async () => {
    const counts: number[] = []
    let full: StoneInstance[] = []
    for (const coverage of [1, 0.6, 0.3]) {
      const e = await kernel.evaluate(iced(heart, { coverage }).design)
      const stones = e.stones.filter((s) => s.nodeId === 'ice')
      counts.push(stones.length)
      if (coverage === 1) full = stones
      else {
        const keys = new Set(full.map((s) => centre(s).map((v) => v.toFixed(5)).join()))
        for (const s of stones) expect(keys.has(centre(s).map((v) => v.toFixed(5)).join())).toBe(true)
      }
    }
    expect(counts[1]!).toBeLessThan(counts[0]!)
    expect(counts[2]!).toBeLessThan(counts[1]!)
  })

  it('is deterministic for the same seed and different for another', async () => {
    const a = await kernel.evaluate(iced(heart, { seed: 3 }).design)
    const fresh = createKernel()
    const b = await fresh.evaluate(iced(heart, { seed: 3 }).design)
    const c = await fresh.evaluate(iced(heart, { seed: 4 }).design)
    fresh.dispose()
    const key = (stones: StoneInstance[]) => JSON.stringify(stones.map((s) => s.matrix.map((v) => v.toFixed(6))))
    expect(key(b.stones)).toBe(key(a.stones))
    expect(key(c.stones)).not.toBe(key(a.stones))
  })

  it('cuts seats and raises beads at production, removing metal overall', async () => {
    const c = iced(heart)
    const draft = await kernel.evaluate(c.design)
    const production = await kernel.evaluate(c.design, { detail: 'production' })
    expect(production.stones.length).toBe(draft.stones.length)
    expect(production.report.metals[0]!.volumeMm3).toBeLessThan(draft.report.metals[0]!.volumeMm3)
    const scene = await kernel.scene(c.design, { detail: 'production' })
    const ice = scene.nodes.get('ice')!
    expect(ice.cuts).toHaveLength(1)
    expect(ice.additions).toHaveLength(1)
    expect(ice.additions[0]!.afterCuts).toBe(true)
    for (const part of scene.parts) expect(edgeTopology(part.fused!.triangles()).open).toBe(0)
  })

  it('warns instead of failing when the stones cannot fit', async () => {
    const tiny: NodeInput = { id: 'body', kind: 'vectorBody', source: { type: 'shape', shape: 'circle' }, height: 3, thickness: 1 }
    const e = await kernel.evaluate(iced(tiny, { sizeMin: 4, sizeMax: 4, margin: 2 }).design)
    expect(e.stones.filter((s) => s.nodeId === 'ice')).toHaveLength(0)
    expect(e.diagnostics.map((d) => d.code)).toContain('pave.empty')
    const off = await kernel.evaluate(iced(heart, { sizeMin: 1.15, sizeMax: 1.15 }).design)
    expect(off.diagnostics.map((d) => d.code)).toContain('pave.sizeRange')
  })
})

describe('templates', () => {
  for (const id of ['name-pendant', 'iced-initial', 'iced-trophy'])
    it(`${id} evaluates at draft and production with the freeform nodes building`, async () => {
      const design = buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
      for (const detail of ['draft', 'production'] as const) {
        const scene = await kernel.scene(design, { detail })
        for (const r of scene.nodes.values())
          if (['vectorBody', 'meshBody', 'relief', 'pave'].includes(r.node.kind))
            expect(r.status, `${r.node.kind}: ${r.diagnostics.map((d) => d.message).join('; ')}`).toBe('ok')
        if (id !== 'name-pendant') expect(scene.evaluation.stones.some((s) => s.setting === 'pave')).toBe(true)
      }
    })
})
