/**
 * Freeform bodies (meshBody, vectorBody, relief) and automatic pavé, end to end through the
 * kernel: every body is a closed manifold with positive volume across the parameter ranges,
 * pavé layouts keep their spacing, sizes, region and margin, seats remove metal at production,
 * and identical input gives identical output.
 */
import {
  applyOps,
  buildDesign,
  designFrom,
  MELEE_SIZES_MM,
  type NodeInput,
  type NodeInputOf,
  TEMPLATES,
} from '@pave/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { invertSimilarity, transformPoint } from '../geometry/vec'
import { createKernel, type LocalKernel } from '../kernel'
import { TriangleBvh } from '../mesh/bvh'
import { grayPng } from '../mesh/image/fixtures'
import { OutlineDistance } from '../mesh/outline/distance'
import type { PaveField } from '../mesh/pave/region'
import { seededRandom } from '../mesh/random'
import { edgeTopology } from '../mesh/topology'
import { meshVolume } from '../solid/meshing'
import { QUALITY } from '../solid/solid'
import { layoutText, loadFont } from '../text'
import type { AssetResolver, StoneInstance } from '../types'

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
  const shapes = [
    'circle',
    'oval',
    'heart',
    'star',
    'cross',
    'shield',
    'hexagon',
    'teardrop',
    'tag',
  ] as const
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
      {
        id: 'v',
        kind: 'vectorBody',
        source: { type: 'shape', shape: 'heart' },
        height: 3,
        thickness: 0.6,
        bevel: 'round',
        bevelSize: 0,
      },
      {
        id: 'v',
        kind: 'vectorBody',
        source: { type: 'shape', shape: 'star' },
        height: 150,
        thickness: 20,
        bevel: 'pillow',
        bevelSize: 5,
        border: 3,
      },
      {
        id: 'v',
        kind: 'vectorBody',
        source: { type: 'shape', shape: 'cross' },
        height: 3,
        thickness: 20,
        bevel: 'chamfer',
        bevelSize: 5,
      },
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
    const d =
      'M10 0a10 10 0 1 1-.01 0zM10 5c3 0 5 2 5 5s-2 5-5 5-5-2-5-5 2-5 5-5z M20,8 h4 v4 h-4 Z'
    await expectSolid({
      id: 'v',
      kind: 'vectorBody',
      source: { type: 'svg', d },
      height: 20,
      bevel: 'flat',
    })
    const e = await kernel.evaluate(
      pendant({
        id: 'v',
        kind: 'vectorBody',
        source: { type: 'svg', d },
        height: 20,
        bevel: 'flat',
      }),
    )
    const b = e.parts[0]!.bounds
    expect(b.max[2] - b.min[2]).toBeCloseTo(20, 2)
    expect(b.max[1]).toBeCloseTo(0, 6)
    expect(b.min[1]).toBeCloseTo(-2, 6)
    // The small square is a separate piece.
    expect(e.diagnostics.map((x) => x.code)).toContain('outline.disconnected')
  })

  it('gives every edge treatment, with and without a border, one clean shell that later steps keep', async () => {
    for (const shape of ['circle', 'hexagon', 'star', 'heart'] as const)
      for (const bevel of bevels)
        for (const border of [0, 1]) {
          const node: VectorInput = {
            id: 'v',
            kind: 'vectorBody',
            source: { type: 'shape', shape },
            height: 24,
            thickness: 4,
            bevel,
            bevelSize: 0.8,
            border,
          }
          const label = `${shape} ${bevel} border ${border}`
          const m = (await kernel.scene(pendant(node))).nodes.get('v')!.bodies[0]!.solid.manifold()
          expect(m.genus(), label).toBe(0)
          expect(m.decompose().length, label).toBe(1)
          // The production assembly simplifies every shell within 5e-4 mm.
          const simplified = m.simplify(5e-4)
          expect(Math.abs(simplified.volume() / m.volume() - 1), label).toBeLessThan(1e-3)
          simplified.delete()
          const draft = await kernel.evaluate(pendant(node))
          const production = await kernel.evaluate(pendant(node), { detail: 'production' })
          const ratio = production.parts[0]!.volumeMm3 / draft.parts[0]!.volumeMm3
          expect(Math.abs(ratio - 1), label).toBeLessThan(1e-3)
        }
  })

  it('leaves out characters the font lacks, saying so, and fails when none are left', async () => {
    const node = (text: string): VectorInput => ({
      id: 'v',
      kind: 'vectorBody',
      source: { type: 'text', text, font: 'sans' },
    })
    const mixed = await kernel.scene(pendant(node('A😀B')))
    expect(mixed.nodes.get('v')!.status).toBe('ok')
    const missing = mixed.evaluation.diagnostics.find((d) => d.code === 'text.missingGlyph')
    expect(missing?.message).toContain('😀')
    const none = await kernel.scene(pendant(node('😀')))
    expect(none.nodes.get('v')!.status).toBe('failed')
    expect(none.evaluation.diagnostics[0]!.message).toMatch(/no letters for “😀”/)
  })

  it('rejects artwork it cannot build with messages a designer can act on', async () => {
    const message = async (d: string, height = 20) => {
      const scene = await kernel.scene(
        pendant({ id: 'v', kind: 'vectorBody', source: { type: 'svg', d }, height }),
      )
      expect(scene.nodes.get('v')!.status).toBe('failed')
      return scene.evaluation.diagnostics.map((x) => x.message).join(' ')
    }
    for (const d of ['', 'M0 0', 'M0 0 L10 10']) expect(await message(d)).toMatch(/no closed area/)
    expect(await message('M0 0 L1e400 5 L3 3 Z')).toMatch(/cannot be read/)
    expect(await message('M0 0 H1000 V1 H0 Z', 3)).toMatch(/3000 mm wide/)
  })

  it('stays fast on artwork traced with tens of thousands of points', async () => {
    // A 22 mm staircase of 16,000 steps finer than any casting can show.
    const steps = Array.from({ length: 16_000 }, (_, i) => (i % 2 ? 'h1' : 'v1')).join('')
    const started = performance.now()
    await expectSolid({
      id: 'v',
      kind: 'vectorBody',
      source: { type: 'svg', d: `M0 0 ${steps} L0 8000 Z` },
    })
    expect(performance.now() - started).toBeLessThan(10_000)
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
      await expectSolid({
        id: 'r',
        kind: 'relief',
        outline,
        rim: i % 2 ? 0 : 0.8,
        invert: i === 2,
      } satisfies ReliefInput)
    await expectSolid({
      id: 'r',
      kind: 'relief',
      width: 4,
      height: 4,
      baseThickness: 0.5,
      depth: 0.1,
      rim: 0,
    })
    await expectSolid({
      id: 'r',
      kind: 'relief',
      outline: 'rect',
      width: 100,
      height: 60,
      baseThickness: 6,
      depth: 6,
      rim: 4,
    })
  })
})

describe('relief from an image', () => {
  it('raises white to the full depth whatever the image size', async () => {
    const images: Record<string, Uint8Array> = {
      one: grayPng(1, 1, () => 1),
      small: grayPng(16, 16, () => 1),
      ramp: grayPng(64, 64, (x) => x / 63),
    }
    const assets: AssetResolver = async (id) => images[id]!
    const relief = (assetId: string): ReliefInput => ({ id: 'r', kind: 'relief', assetId, rim: 0 })
    for (const id of ['one', 'small']) {
      const e = await kernel.evaluate(pendant(relief(id)), { assets })
      // Default base 1.2 mm and depth 0.8 mm: the relief tops out 2 mm from the back.
      expect(e.parts[0]!.bounds.min[1], id).toBeCloseTo(-2, 2)
    }
    // A ramp rises steadily left to right, with no rows left at the base between pixel rows.
    const scene = await kernel.scene(pendant(relief('ramp')), { assets })
    const tris = scene.nodes.get('r')!.bodies[0]!.solid.triangles(QUALITY.draft)
    const front = (x: number, z: number) => {
      let best = 0
      for (let i = 0; i < tris.positions.length; i += 3)
        if (Math.abs(tris.positions[i]! - x) < 0.3 && Math.abs(tris.positions[i + 2]! - z) < 0.3)
          best = Math.min(best, tris.positions[i + 1]!)
      return -best
    }
    for (const z of [-2, -1.05, 0, 0.95, 2]) {
      expect(front(-4, z)).toBeLessThan(front(0, z))
      expect(front(0, z)).toBeLessThan(front(4, z))
      expect(front(0, z)).toBeGreaterThan(1.5)
    }
  })
})

describe('meshBody', () => {
  it('builds the built-in models, honouring height, flat back, hollow and smoothing', async () => {
    for (const name of ['trophy', 'crown', 'dice'] as const) {
      await expectSolid({ id: 'm', kind: 'meshBody', source: { type: 'builtin', name } })
      const e = await kernel.evaluate(
        pendant({ id: 'm', kind: 'meshBody', source: { type: 'builtin', name }, height: 30 }),
      )
      const b = e.parts[0]!.bounds
      expect(b.max[2] - b.min[2]).toBeCloseTo(30, 3)
      expect(b.max[1]).toBeCloseTo(0, 6)
    }
    const solid = await expectSolid({
      id: 'm',
      kind: 'meshBody',
      source: { type: 'builtin', name: 'trophy' },
      height: 40,
      flatBack: 0.35,
    })
    const hollow = await expectSolid({
      id: 'm',
      kind: 'meshBody',
      source: { type: 'builtin', name: 'trophy' },
      height: 40,
      flatBack: 0.35,
      hollow: 1,
    })
    expect(hollow).toBeLessThan(solid * 0.8)
    await expectSolid({
      id: 'm',
      kind: 'meshBody',
      source: { type: 'builtin', name: 'dice' },
      height: 3,
      smooth: 8,
      detail: 0.02,
    })
    await expectSolid({
      id: 'm',
      kind: 'meshBody',
      source: { type: 'builtin', name: 'crown' },
      height: 200,
      flatBack: 0.9,
    } satisfies MeshInput)
  })
})

describe('meshBody processing', () => {
  it('keeps every built-in whole when smoothed', async () => {
    for (const name of ['trophy', 'crown', 'dice'] as const) {
      const volume = async (smooth: number) => {
        const e = await kernel.evaluate(
          pendant({
            id: 'm',
            kind: 'meshBody',
            source: { type: 'builtin', name },
            height: 40,
            smooth,
          }),
        )
        return e.parts[0]!.volumeMm3
      }
      const raw = await volume(0)
      for (const level of [1, 8])
        expect(Math.abs((await volume(level)) / raw - 1), `${name} at ${level}`).toBeLessThan(0.03)
    }
  })

  it('hollows into one piece with its own escape holes per cavity, in seconds', async () => {
    const started = performance.now()
    const scene = await kernel.scene(
      pendant({
        id: 'm',
        kind: 'meshBody',
        source: { type: 'builtin', name: 'trophy' },
        height: 40,
        hollow: 0.8,
      }),
    )
    expect(performance.now() - started).toBeLessThan(15_000)
    const codes = scene.evaluation.diagnostics.map((d) => d.code)
    expect(codes).not.toContain('mesh.disconnected')
    expect(codes).toContain('mesh.drains')
    // No sealed specks of cavity left in the wall: one shell.
    expect(scene.nodes.get('m')!.bodies[0]!.solid.manifold().decompose().length).toBe(1)
  })

  it('rebuilds a broken mesh at a sensible density, and rejects a flat one plainly', async () => {
    // A sphere with a tenth of its faces missing must be re-surfaced.
    const tris: number[][] = []
    const at = (i: number, j: number) => {
      const t = (Math.PI * i) / 40
      const f = (Math.PI * j) / 40
      return [10 * Math.sin(t) * Math.cos(f), 10 * Math.sin(t) * Math.sin(f), 10 * Math.cos(t)]
    }
    const random = seededRandom(5)
    for (let i = 0; i < 40; i++)
      for (let j = 0; j < 80; j++) {
        if (i > 0 && random() > 0.1) tris.push([...at(i, j), ...at(i + 1, j), ...at(i, j + 1)])
        if (i < 39 && random() > 0.1)
          tris.push([...at(i, j + 1), ...at(i + 1, j), ...at(i + 1, j + 1)])
      }
    const stl = (faces: number[][]) => {
      const bytes = new Uint8Array(84 + faces.length * 50)
      const view = new DataView(bytes.buffer)
      view.setUint32(80, faces.length, true)
      faces.forEach((f, i) => {
        f.forEach((v, k) => {
          view.setFloat32(84 + i * 50 + 12 + k * 4, v, true)
        })
      })
      return bytes
    }
    // A closed box of zero thickness (10 × 10 × 0 mm): every face present, no volume inside.
    const corner = (k: number) => [k & 1 ? 10 : 0, k & 2 ? 10 : 0, 0]
    const quads = [
      [0, 2, 3, 1],
      [4, 5, 7, 6],
      [0, 1, 5, 4],
      [1, 3, 7, 5],
      [3, 2, 6, 7],
      [2, 0, 4, 6],
    ]
    const sheet = quads.flatMap(([a, b, c, d]) => [
      [...corner(a!), ...corner(b!), ...corner(c!)],
      [...corner(a!), ...corner(c!), ...corner(d!)],
    ])
    const files: Record<string, Uint8Array> = { holey: stl(tris), flat: stl(sheet) }
    const assets: AssetResolver = async (id) => files[id]!
    const mesh = (assetId: string): MeshInput => ({
      id: 'm',
      kind: 'meshBody',
      source: { type: 'asset', assetId },
    })
    const scene = await kernel.scene(pendant(mesh('holey')), { assets })
    expect(scene.evaluation.diagnostics.map((d) => d.code)).toContain('mesh.resurfaced')
    expect(
      scene.nodes.get('m')!.bodies[0]!.solid.triangles(QUALITY.draft).indices.length / 3,
    ).toBeLessThan(40_000)
    const flat = await kernel.scene(pendant(mesh('flat')), { assets })
    expect(flat.evaluation.diagnostics[0]!.message).toMatch(/does not enclose a volume/)
  })
})

// ── Pavé ─────────────────────────────────────────────────────────────────────────────────────

interface PaveCase {
  design: ReturnType<typeof pendant>
  pave: NodeInputOf<'pave'>
}

function iced(body: NodeInput, pave: Partial<NodeInputOf<'pave'>> = {}): PaveCase {
  const node: NodeInputOf<'pave'> = {
    id: 'ice',
    kind: 'pave',
    host: body.id,
    sizeMax: 1.6,
    sizeMin: 1,
    ...pave,
  }
  return { design: pendant(body, node), pave: node }
}

const centre = (s: StoneInstance): [number, number, number] => [
  s.matrix[12]!,
  s.matrix[13]!,
  s.matrix[14]!,
]

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

  it('fills a bordered field with stock stones, spaced, inside the field and up to its rim', async () => {
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
      // The rim is the seat wall: the outer row goes right up to it, the wall holding the
      // girdles as a bezel does (mesh/pave/beads.ts WALL_HOLD), and never into it.
      expect(field.distance(x, z)).toBeGreaterThanOrEqual(s.dims.width / 2 - 0.01)
    }
    // Honeycomb: most stones are the largest size, with six neighbours inside the field.
    const largest = stones.filter((s) => s.dims.width === 1.5).length
    expect(largest / stones.length).toBeGreaterThan(0.8)
  })

  it('covers only the faces within the requested angle of the direction', async () => {
    const trophy: NodeInput = {
      id: 'body',
      kind: 'meshBody',
      source: { type: 'builtin', name: 'trophy' },
      height: 45,
      flatBack: 0.35,
    }
    const c = iced(trophy, {
      sizeMax: 1.8,
      sizeMin: 1,
      region: { type: 'facing', direction: [0, -1, 0], maxAngle: 60 },
    })
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
        const keys = new Set(
          full.map((s) =>
            centre(s)
              .map((v) => v.toFixed(5))
              .join(),
          ),
        )
        for (const s of stones)
          expect(
            keys.has(
              centre(s)
                .map((v) => v.toFixed(5))
                .join(),
            ),
          ).toBe(true)
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
    const key = (stones: StoneInstance[]) =>
      JSON.stringify(stones.map((s) => s.matrix.map((v) => v.toFixed(6))))
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

  it('keeps the margin on a body without a border, and seats that never break through', async () => {
    const disc: NodeInput = {
      id: 'body',
      kind: 'vectorBody',
      source: { type: 'shape', shape: 'circle' },
      height: 20,
      thickness: 2,
      bevel: 'flat',
    }
    const c = iced(disc, { sizeMax: 1.8, sizeMin: 1, margin: 0.35 })
    const draft = await kernel.evaluate(c.design)
    const stones = draft.stones.filter((s) => s.nodeId === 'ice')
    expect(stones.length).toBeGreaterThan(50)
    // The seat-wall rule (0.4 mm) wins over a smaller margin.
    for (const s of stones)
      expect(10 - Math.hypot(s.matrix[12]!, s.matrix[14]!)).toBeGreaterThanOrEqual(
        s.dims.width / 2 + 0.4 - 0.005,
      )
    const scene = await kernel.scene(c.design, { detail: 'production' })
    expect(scene.parts).toHaveLength(1)
    // Blind holes: the plate gains no tunnels through to its back.
    expect(scene.parts[0]!.fused!.manifold().genus()).toBe(0)
    expect(scene.evaluation.diagnostics.map((d) => d.code)).not.toContain('seat.wall')
  })

  it('shares the metal of a plate paved on both faces, leaving no loose beads', async () => {
    const plate = (thickness: number): NodeInput => ({
      id: 'body',
      kind: 'vectorBody',
      source: { type: 'shape', shape: 'circle' },
      height: 16,
      thickness,
      bevel: 'flat',
    })
    // Too thin for seats from both sides: no stones, and a warning rather than a failure.
    const thin = await kernel.evaluate(iced(plate(1.2), { region: { type: 'all' } }).design)
    expect(thin.stones.filter((s) => s.nodeId === 'ice')).toHaveLength(0)
    expect(thin.diagnostics.map((d) => d.code)).toContain('pave.empty')
    const c = iced(plate(3), { region: { type: 'all' } })
    const scene = await kernel.scene(c.design, { detail: 'production' })
    expect(scene.evaluation.stones.filter((s) => s.nodeId === 'ice').length).toBeGreaterThan(50)
    expect(scene.parts).toHaveLength(1)
    expect(scene.evaluation.diagnostics.map((d) => d.code)).not.toContain('metal.fragment')
  })

  it('warns instead of failing when the stones cannot fit', async () => {
    const tiny: NodeInput = {
      id: 'body',
      kind: 'vectorBody',
      source: { type: 'shape', shape: 'circle' },
      height: 3,
      thickness: 1,
    }
    const e = await kernel.evaluate(iced(tiny, { sizeMin: 4, sizeMax: 4, margin: 2 }).design)
    expect(e.stones.filter((s) => s.nodeId === 'ice')).toHaveLength(0)
    expect(e.diagnostics.map((d) => d.code)).toContain('pave.empty')
    const off = await kernel.evaluate(iced(heart, { sizeMin: 1.15, sizeMax: 1.15 }).design)
    expect(off.diagnostics.map((d) => d.code)).toContain('pave.sizeRange')
  })
})

/**
 * Coverage of a flat pavé face seen from the front, on a 0.1 mm grid: the share of the field
 * (the face inside the margin) farther than 0.5 mm from any stone, and the separate spots where
 * a stone of `size` would still fit with the gap and margin kept (seats the packer missed).
 */
function coverage(
  scene: Awaited<ReturnType<LocalKernel['scene']>>,
  thickness: number,
  pave: { margin: number; gap: number },
  size: number,
): { bald: number; missed: number } {
  const host = scene.nodes.get('b')!
  const tris = host.bodies[0]!.solid.triangles(QUALITY.draft)
  const positions = new Float32Array(tris.positions.length)
  for (let i = 0; i < tris.positions.length; i += 3) {
    const p = transformPoint(host.matrix, [
      tris.positions[i]!,
      tris.positions[i + 1]!,
      tris.positions[i + 2]!,
    ])
    positions.set(p, i)
  }
  const bvh = new TriangleBvh({ positions, indices: tris.indices })
  const stones = scene.evaluation.stones
    .filter((x) => x.nodeId === 'ice')
    .map((x) => ({ c: centre(x), r: x.dims.width / 2 }))
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]!)
    maxX = Math.max(maxX, positions[i]!)
    minZ = Math.min(minZ, positions[i + 2]!)
    maxZ = Math.max(maxZ, positions[i + 2]!)
  }
  const h = 0.1
  const nx = Math.ceil((maxX - minX) / h) + 3
  const nz = Math.ceil((maxZ - minZ) / h) + 3
  const x = (k: number) => minX + ((k % nx) - 1) * h
  const z = (k: number) => minZ + (Math.floor(k / nx) - 1) * h
  // Distance to the face's edge (chamfer, 3–4 weights) and to the nearest stone's girdle.
  const edge = new Float32Array(nx * nz)
  const clear = new Float32Array(nx * nz).fill(1e9)
  for (let k = 0; k < edge.length; k++) {
    const t = bvh.raycast(x(k), -50, z(k), 0, 1, 0)
    edge[k] = t !== Infinity && Math.abs(t - 50 + thickness) < 0.02 ? 1e9 : 0
    for (const s of stones) {
      const d = Math.hypot(x(k) - s.c[0], z(k) - s.c[2]) - s.r
      if (d < clear[k]!) clear[k] = d
    }
  }
  const relax = (k: number, o: number, w: number) => {
    if (edge[o]! + w < edge[k]!) edge[k] = edge[o]! + w
  }
  const diag = h * Math.SQRT2
  for (let j = 1; j < nz - 1; j++)
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i
      relax(k, k - 1, h)
      relax(k, k - nx, h)
      relax(k, k - nx - 1, diag)
      relax(k, k - nx + 1, diag)
    }
  for (let j = nz - 2; j > 0; j--)
    for (let i = nx - 2; i > 0; i--) {
      const k = j * nx + i
      relax(k, k + 1, h)
      relax(k, k + nx, h)
      relax(k, k + nx + 1, diag)
      relax(k, k + nx - 1, diag)
    }
  let field = 0
  let bald = 0
  const fits = new Uint8Array(nx * nz)
  for (let k = 0; k < edge.length; k++) {
    if (edge[k]! < pave.margin) continue
    field++
    if (clear[k]! > 0.5) bald++
    // A tenth of a millimetre of slack for the grid.
    if (edge[k]! - pave.margin >= size / 2 + 0.1 && clear[k]! - pave.gap >= size / 2 + 0.1)
      fits[k] = 1
  }
  let missed = 0
  for (let k = 0; k < fits.length; k++) {
    if (fits[k] !== 1) continue
    missed++
    const stack = [k]
    fits[k] = 2
    while (stack.length > 0) {
      const c = stack.pop()!
      for (const o of [c - 1, c + 1, c - nx, c + nx])
        if (fits[o] === 1) {
          fits[o] = 2
          stack.push(o)
        }
    }
  }
  return { bald: bald / field, missed }
}

describe('pave layout: what the follow-up found', () => {
  // Strokes narrower than a letter's stem (the K's arm, the N's diagonal) and spots a sample
  // never hit were left bare: one stone on the K's upper arm, seats a stone still fitted.
  it('leaves no seat a stone would fit and no bald strokes on letters and a star', async () => {
    const flat = { thickness: 2.5, bevel: 'flat' as const, bevelSize: 0 }
    const king: NodeInput = {
      id: 'b',
      kind: 'vectorBody',
      source: { type: 'text', text: 'KING', font: 'block' },
      height: 18,
      ...flat,
      thickness: 3,
    }
    const star: NodeInput = {
      id: 'b',
      kind: 'vectorBody',
      source: { type: 'shape', shape: 'star' },
      height: 30,
      ...flat,
    }
    for (const [name, body, thickness, sizeMin, sizeMax, bald] of [
      // The square ends of the strokes keep bare corners a stone's width wide (5.0 % of the
      // field, against 5.5 % before): the rows stop a stone short of them.
      ['KING', king, 3, 1, 1.8, 0.052],
      // A 1.3 mm stone does not fit the N's diagonal inside the margin at all: no seats are
      // missed, but that stroke stays bare whatever the layout.
      ['KING', king, 3, 1.3, 1.3, 1],
      ['star', star, 2.5, 1, 1.8, 0.05],
      ['star', star, 2.5, 1.3, 1.3, 0.05],
      ['star', star, 2.5, 0.8, 1.5, 0.05],
    ] as const) {
      const c = iced(body, { sizeMin, sizeMax })
      const scene = await kernel.scene(c.design, { detail: 'draft' })
      const node = c.design.nodes.ice as unknown as { margin: number; gap: number }
      // Measured as the engine pass measured it: the field starts at least 0.4 mm in, where
      // the edge's own beads stand.
      const got = coverage(
        scene,
        thickness,
        { ...node, margin: Math.max(node.margin, 0.4) },
        sizeMin,
      )
      const label = `${name} ${sizeMin}–${sizeMax}`
      expect(got.missed, label).toBe(0)
      expect(got.bald, label).toBeLessThan(bald)
    }
  }, 180_000)
})

describe('pave on sculpted hosts: what the follow-up found', () => {
  // On the solid trophy one stone was set upside down and buried where the handle meets the
  // cup: its seat was snapped onto the plane of a sample on the other surface of the crease.
  // On the relief, small stones stood above its sloping face, held by nothing.
  it('sets every stone upright on its face, neither buried nor floating', async () => {
    const trophy: NodeInput = {
      id: 'b',
      kind: 'meshBody',
      source: { type: 'builtin', name: 'trophy' },
      height: 45,
    }
    const relief: NodeInput = { id: 'b', kind: 'relief', width: 24, height: 24 }
    for (const [body, sizeMin, sizeMax, all] of [
      [trophy, 1, 1.8, true],
      [trophy, 3, 3, true],
      [relief, 0.8, 0.8, false],
    ] as const) {
      const c = iced(body, {
        sizeMin,
        sizeMax,
        ...(all ? { region: { type: 'all' as const } } : {}),
      })
      const scene = await kernel.scene(c.design, { detail: 'draft' })
      const host = scene.nodes.get('b')!
      const tris = host.bodies[0]!.solid.triangles(QUALITY.draft)
      const positions = new Float32Array(tris.positions.length)
      for (let i = 0; i < tris.positions.length; i += 3)
        positions.set(
          transformPoint(host.matrix, [
            tris.positions[i]!,
            tris.positions[i + 1]!,
            tris.positions[i + 2]!,
          ]),
          i,
        )
      const bvh = new TriangleBvh({ positions, indices: tris.indices })
      const vertex = (k: number): [number, number, number] => [
        positions[k * 3]!,
        positions[k * 3 + 1]!,
        positions[k * 3 + 2]!,
      ]
      for (const stone of scene.evaluation.stones.filter((x) => x.nodeId === 'ice')) {
        const m = stone.matrix
        const len = Math.hypot(m[8]!, m[9]!, m[10]!)
        const n = [m[8]! / len, m[9]! / len, m[10]! / len] as const
        const p = centre(stone)
        const d = stone.dims.width
        // The surface over the girdle, looking down the stone's axis from two stones above.
        const hit = bvh.firstHit(
          p[0] + 2 * d * n[0],
          p[1] + 2 * d * n[1],
          p[2] + 2 * d * n[2],
          -n[0],
          -n[1],
          -n[2],
        )
        const label = `${body.kind} ${sizeMin}–${sizeMax} at ${p.map((v) => v.toFixed(2)).join(', ')}`
        expect(hit.triangle, label).toBeGreaterThanOrEqual(0)
        const sink = (2 * d - hit.t) / d
        expect(sink, label).toBeLessThanOrEqual(0.25)
        expect(sink, label).toBeGreaterThan(-0.02)
        const [a, b, c2] = [0, 1, 2].map((j) => vertex(tris.indices[hit.triangle * 3 + j]!))
        const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]]
        const v = [c2![0] - a![0], c2![1] - a![1], c2![2] - a![2]]
        const f = [
          u[1]! * v[2]! - u[2]! * v[1]!,
          u[2]! * v[0]! - u[0]! * v[2]!,
          u[0]! * v[1]! - u[1]! * v[0]!,
        ]
        const fl = Math.hypot(f[0]!, f[1]!, f[2]!)
        const tilt =
          (Math.acos(Math.min(1, (f[0]! * n[0] + f[1]! * n[1] + f[2]! * n[2]) / fl)) * 180) /
          Math.PI
        expect(tilt, label).toBeLessThan(25)
      }
    }
  }, 180_000)
})

describe('pave on hollow and many-sided bodies', () => {
  const dice = (extra: Partial<MeshInput>): MeshInput => ({
    id: 'body',
    kind: 'meshBody',
    source: { type: 'builtin', name: 'dice' },
    height: 20,
    ...extra,
  })

  it('never sets stones on the walls of a cavity or on a flat back', async () => {
    for (const extra of [{ hollow: 3 }, { hollow: 2 }, { hollow: 3, flatBack: 0.3 }]) {
      const c = iced(dice(extra), { sizeMax: 1.8, sizeMin: 1, region: { type: 'all' } })
      const scene = await kernel.scene(c.design)
      const stones = scene.evaluation.stones.filter((s) => s.nodeId === 'ice')
      expect(stones.length, JSON.stringify(extra)).toBeGreaterThan(150)
      const b = scene.nodes.get('body')!.bodies[0]!.solid.bounds()
      const mid = [0, 1, 2].map((k) => (b.min[k]! + b.max[k]!) / 2)
      for (const s of stones) {
        const p = centre(s)
        const n = [s.matrix[8]!, s.matrix[9]!, s.matrix[10]!]
        // A stone on the outside faces away from the middle; one in the cavity faces into it.
        expect(n.reduce((sum, v, k) => sum + v * (p[k]! - mid[k]!), 0)).toBeGreaterThan(0)
        // None on the flat back (y = 0, facing +Y).
        if (extra.flatBack) expect(n[1]! / Math.hypot(n[0]!, n[1]!, n[2]!)).toBeLessThan(0.9)
      }
    }
  })

  it('cuts seats from neighbouring faces without tunnels between them', async () => {
    // A 14 mm dice paved all over: seats and holes on faces at right angles meet inside the
    // corner unless each is checked against the others. The casting gains no handles.
    const c = iced(dice({ height: 14 }), { sizeMax: 1.8, sizeMin: 1, region: { type: 'all' } })
    const scene = await kernel.scene(c.design, { detail: 'production' })
    expect(scene.evaluation.stones.filter((s) => s.nodeId === 'ice').length).toBeGreaterThan(100)
    expect(scene.nodes.get('body')!.bodies[0]!.solid.manifold().genus()).toBe(0)
    expect(scene.parts).toHaveLength(1)
    expect(scene.parts[0]!.fused!.manifold().genus()).toBe(0)
  }, 60_000)

  it('says when walls are too thin for the stones, with a hollow that takes them', async () => {
    const c = iced(dice({ height: 30, hollow: 0.7 }), { sizeMax: 1.8, sizeMin: 1.8 })
    const e = await kernel.evaluate(c.design)
    const thin = e.diagnostics.find((d) => d.code === 'pave.thin')
    expect(thin?.message).toMatch(/a 1\.8 mm stone needs 1\.57 mm/)
    expect(thin?.fix?.ops).toEqual([{ t: 'update', id: 'body', patch: { hollow: 1.6 } }])
    expect(e.diagnostics.map((d) => d.code)).not.toContain('pave.sparse')
  })

  it('keeps sound hollow and smoothed bodies in one piece, without zero-volume specks', async () => {
    for (const extra of [
      { source: { type: 'builtin', name: 'trophy' }, height: 40, flatBack: 0.5, hollow: 0.7 },
      { source: { type: 'builtin', name: 'dice' }, height: 40, smooth: 2, detail: 0.02 },
    ] as Partial<MeshInput>[]) {
      const scene = await kernel.scene(pendant({ ...dice({}), ...extra }))
      const codes = scene.evaluation.diagnostics.map((d) => d.code)
      expect(codes, JSON.stringify(extra)).not.toContain('mesh.disconnected')
      expect(scene.nodes.get('body')!.bodies[0]!.solid.manifold().decompose().length).toBe(1)
    }
  }, 60_000)
})

describe('outline bodies: what the engine pass found', () => {
  it('ties the dots and capitals of a script name into one piece', async () => {
    for (const text of ['Olivia', 'Tej', 'William']) {
      const scene = await kernel.scene(
        pendant({
          id: 'v',
          kind: 'vectorBody',
          source: { type: 'text', text, font: 'script' },
          height: 14,
        }),
      )
      const codes = scene.evaluation.diagnostics.map((d) => d.code)
      expect(codes, text).toContain('outline.joined')
      expect(codes, text).not.toContain('outline.disconnected')
      expect(scene.nodes.get('v')!.bodies[0]!.solid.manifold().decompose().length, text).toBe(1)
    }
  })

  it('meets the overall height on pointed shapes, whose corners are softened', async () => {
    for (const shape of ['star', 'heart', 'teardrop'] as const) {
      const e = await kernel.evaluate(
        pendant({ id: 'v', kind: 'vectorBody', source: { type: 'shape', shape }, height: 22 }),
      )
      const b = e.parts[0]!.bounds
      expect(b.max[2] - b.min[2], shape).toBeCloseTo(22, 2)
    }
  })

  it('fits a bevel to a thin plate instead of failing', async () => {
    const scene = await kernel.scene(
      pendant({
        id: 'v',
        kind: 'vectorBody',
        source: { type: 'text', text: 'A', font: 'block' },
        height: 30,
        thickness: 0.6,
        bevel: 'pillow',
        bevelSize: 0.8,
        border: 0.8,
      }),
    )
    expect(scene.nodes.get('v')!.status).toBe('ok')
    expect(scene.evaluation.diagnostics.map((d) => d.code)).toContain('outline.bevelReduced')
  })

  it('kerns sans and serif pairs, whose kerning sits in extension lookups', async () => {
    for (const font of ['sans', 'serif'] as const) {
      const f = await loadFont(font)
      const width = (t: string) => layoutText(f, t, 10).width
      expect(width('AV'), font).toBeLessThan(width('A') + width('V') - 0.3)
      expect(width('HH'), font).toBeCloseTo(2 * width('H'), 6)
    }
  })

  // Polish, Czech, Hungarian and Turkish names once failed in every bundled font, which hold
  // only Latin-1: their letters are composed from the base letter and the font's own marks.
  it('composes Latin Extended-A letters the fonts lack, and flags what it cannot draw', async () => {
    for (const font of ['sans', 'serif', 'script', 'block'] as const) {
      const scene = await kernel.scene(
        pendant({
          id: 'v',
          kind: 'vectorBody',
          source: { type: 'text', text: 'ŻÓŁĆ Šťěpán Őrsi Şengül Ğİ ąę ☆', font },
          height: 8,
        }),
      )
      const d = scene.evaluation.diagnostics
      expect(scene.nodes.get('v')!.status, font).toBe('ok')
      const composed = d.find((x) => x.code === 'text.composed')
      for (const c of ['Ż', 'Ł', 'Ć', 'Š', 'ť', 'ě', 'Ő', 'Ş', 'Ğ', 'İ', 'ą', 'ę'])
        expect(composed?.message, `${font} ${c}`).toContain(`“${c}”`)
      expect(
        d.find((x) => x.code === 'text.accentDropped'),
        font,
      ).toBeUndefined()
      expect(d.find((x) => x.code === 'text.missingGlyph')?.level, font).toBe('error')
    }
    // A mark with no donor in the font (a dot below) still sets the base letter, as an error.
    const scene = await kernel.scene(
      pendant({ id: 'v', kind: 'vectorBody', source: { type: 'text', text: 'Ṃa', font: 'sans' } }),
    )
    const accent = scene.evaluation.diagnostics.find((x) => x.code === 'text.accentDropped')
    expect(accent?.message).toMatch(/“Ṃ” was set as “M”/)
    expect(accent?.level).toBe('error')
  }, 180_000)

  // The rule that sets an i's dot down onto its stem was applied to every mark: umlauts and
  // acutes were pushed into their letters, and the name came out up to 0.8 mm short.
  it('keeps accented names at the height asked, with the accents above their letters', async () => {
    const body = async (text: string, font: 'block' | 'script', join: 'auto' | 'off') => {
      const scene = await kernel.scene(
        pendant({
          id: 'v',
          kind: 'vectorBody',
          source: { type: 'text', text, font },
          height: 12,
          thickness: 1.6,
          bevel: 'flat',
          bevelSize: 0,
          join,
        }),
      )
      const m = scene.nodes.get('v')!.bodies[0]!.solid.manifold()
      const box = m.boundingBox()
      // The top half millimetre (the accents' tops), whose metal must not move or fuse.
      const slab = m.trimByPlane([0, 0, 1], box.max[2] - 0.5)
      const top = slab.volume()
      slab.delete()
      return { height: box.max[2] - box.min[2], top }
    }
    for (const [text, font] of [
      ['MÜLLER', 'block'],
      ['JOSÉ', 'block'],
      ['Zoë', 'block'],
      ['Zoë', 'script'],
    ] as const) {
      const joined = await body(text, font, 'auto')
      const loose = await body(text, font, 'off')
      // As tall as with the marks left loose: 12 mm, or a hair more where hairlines of the
      // script were thickened.
      expect(joined.height, `${font} ${text}`).toBeCloseTo(loose.height, 3)
      expect(Math.abs(loose.height - 12), `${font} ${text}`).toBeLessThan(0.1)
      expect(joined.top, `${font} ${text}`).toBeCloseTo(loose.top, 3)
    }
  }, 120_000)
})

describe('outline bodies: what the follow-up found', () => {
  const name = (
    text: string,
    font: 'sans' | 'serif' | 'script' | 'block',
    join: 'auto' | 'off' | 'underline' = 'auto',
  ) =>
    kernel.scene(
      pendant({
        id: 'v',
        kind: 'vectorBody',
        source: { type: 'text', text, font },
        height: 12,
        thickness: 1.6,
        bevel: 'flat',
        bevelSize: 0,
        join,
      }),
    )

  // Umlauts over a capital's counter, dots set just off a lowercase stem, a tilde and an acute
  // beside their letter's corner: each was left loose, or on a sloped sprue that touched a round
  // dot at one point only, and a cast name lost it.
  it('hangs every accent of sans, serif and script names on its letter, in one piece', async () => {
    for (const font of ['sans', 'serif', 'script'] as const)
      for (const text of ['MÜLLER', 'Zoë', 'Ñandú', 'Şükrü']) {
        const scene = await name(text, font)
        const codes = scene.evaluation.diagnostics.map((d) => d.code)
        expect(codes, `${font} ${text}`).not.toContain('outline.disconnected')
        const m = scene.nodes.get('v')!.bodies[0]!.solid.manifold()
        const pieces = m.decompose()
        expect(pieces.length, `${font} ${text}`).toBe(1)
        for (const p of pieces) p.delete()
        const box = m.boundingBox()
        expect(box.max[2] - box.min[2], `${font} ${text}`).toBeGreaterThan(11.9)
      }
  }, 240_000)

  // The warning said only how many pieces there were, and advised a script font, which leaves
  // accents loose too.
  it('names the letter whose accent stays loose, without advising another font', async () => {
    const scene = await name('İpek', 'script')
    const loose = scene.evaluation.diagnostics.find((d) => d.code === 'outline.disconnected')
    expect(loose?.message).toContain('“İ”')
    expect(loose?.message).not.toMatch(/script|font/)
  })

  // Setting an i's dot down onto its stem lowered the name's top when the dot was its highest
  // point: Lubica came out 11.62 mm tall against the 12 asked.
  it('keeps a name whose i dot is its highest point at the height asked', async () => {
    for (const text of ['Lubica', 'Ľubica']) {
      const scene = await name(text, 'sans')
      const box = scene.nodes.get('v')!.bodies[0]!.solid.manifold().boundingBox()
      expect(box.max[2] - box.min[2], text).toBeCloseTo(12, 1)
    }
  })
})

describe('engraving around a band', () => {
  it('says text longer than the band laps over itself, with letters that fit', async () => {
    const band = (size: number, text: string) =>
      buildDesign({
        title: 't',
        summary: 's',
        kind: 'ring',
        archetype: 'band',
        ring: { size: { system: 'us', value: size } },
        engraving: text,
      })
    const long = 'forever and always '.repeat(4).slice(0, 60)
    // The recipe sets a long text small enough for the band it builds…
    expect((await kernel.evaluate(band(4, long))).diagnostics.map((x) => x.code)).not.toContain(
      'engraving.tooLong',
    )
    // …and letters made larger again lap over themselves, with a size that fits as the fix.
    const large = applyOps(band(4, long), [
      { t: 'update', id: 'engraving', patch: { size: 1.4 } },
    ]).design
    const e = await kernel.evaluate(large)
    const d = e.diagnostics.find((x) => x.code === 'engraving.tooLong')
    expect(d?.message).toMatch(/lap over itself/)
    const op = d?.fix?.ops[0]
    const size = op?.t === 'update' ? Number(op.patch.size) : 0
    expect(size).toBeGreaterThan(0.5)
    // The suggested letters fit; a bigger ring takes the same text as it is.
    expect(
      (await kernel.evaluate(applyOps(large, d!.fix!.ops).design)).diagnostics.map((x) => x.code),
    ).not.toContain('engraving.tooLong')
    expect((await kernel.evaluate(band(9, long))).diagnostics.map((x) => x.code)).not.toContain(
      'engraving.tooLong',
    )
  })
})

describe('meshBody: what the engine pass found', () => {
  it('warns about a closed sheet too thin to cast', async () => {
    // An ASCII STL box w × d × h: corners by bit (x, y, z), two triangles per face.
    const box = (w: number, d: number, h: number) => {
      const v = (i: number) => [i & 1 ? w : 0, i & 2 ? d : 0, i & 4 ? h : 0].join(' ')
      const quads = [
        [0, 2, 3, 1],
        [4, 5, 7, 6],
        [0, 1, 5, 4],
        [2, 6, 7, 3],
        [0, 4, 6, 2],
        [1, 3, 7, 5],
      ]
      const facets = quads.flatMap(([a, b, c, e]) => [
        [a!, b!, c!],
        [a!, c!, e!],
      ])
      const body = facets
        .map(
          (t) =>
            `facet normal 0 0 0\nouter loop\n${t.map((i) => `vertex ${v(i)}`).join('\n')}\nendloop\nendfacet`,
        )
        .join('\n')
      return `solid s\n${body}\nendsolid s\n`
    }
    const assets: AssetResolver = async () => new TextEncoder().encode(box(40, 0.001, 40))
    const scene = await kernel.scene(
      pendant({
        id: 'm',
        kind: 'meshBody',
        source: { type: 'asset', assetId: 'sheet' },
        height: 40,
      }),
      { assets },
    )
    expect(scene.evaluation.diagnostics.map((d) => d.code)).toContain('wall.thin')
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
            expect(
              r.status,
              `${r.node.kind}: ${r.diagnostics.map((d) => d.message).join('; ')}`,
            ).toBe('ok')
        if (id !== 'name-pendant')
          expect(scene.evaluation.stones.some((s) => s.setting === 'pave')).toBe(true)
      }
    })
})
