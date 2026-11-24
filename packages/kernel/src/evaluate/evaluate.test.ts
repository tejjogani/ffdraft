import {
  applyOps,
  buildDesign,
  designFrom,
  metalMassG,
  type NodeInput,
  TEMPLATES,
} from '@pave/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import { QUALITY } from '../core'
import { createKernel } from '../kernel'
import { runtime } from '../runtime/index'
import { weld } from '../solid/meshing'
import { coreEvaluator, evaluate, failures } from '../testing/core'
import type { MeshData } from '../types'
import type { Evaluator } from './evaluate'

let evaluator: Evaluator
beforeAll(async () => {
  evaluator = await coreEvaluator()
})

const template = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)

/**
 * What a caster's software would reject: with vertices identified by position (as in an STL),
 * every edge must be shared by exactly two triangles and no triangle may have collapsed.
 */
function castingFaults(mesh: MeshData): { openOrPinchedEdges: number; collapsedTriangles: number } {
  const welded = weld(mesh.positions, mesh.indices)
  const n = welded.positions.length / 3
  const uses = new Map<number, number>()
  for (let t = 0; t < welded.indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = welded.indices[t + e]!
      const b = welded.indices[t + ((e + 1) % 3)]!
      const key = a < b ? a * n + b : b * n + a
      uses.set(key, (uses.get(key) ?? 0) + 1)
    }
  return {
    openOrPinchedEdges: [...uses.values()].filter((c) => c !== 2).length,
    collapsedTriangles: (mesh.indices.length - welded.indices.length) / 3,
  }
}

describe('numbers', () => {
  it('a US 6 ring has a 16.51 mm bore — in the report and in the metal', async () => {
    const scene = await evaluator.scene(template('solitaire'), { detail: 'production' })
    expect(scene.evaluation.report.ringInnerDiameter).toBeCloseTo(16.51, 2)
    // Smallest distance from the finger's axis (Y) to any vertex of the band.
    const { positions } = scene.nodes.get('band')!.bodies[0]!.solid.triangles(QUALITY.production)
    let bore = Infinity
    for (let i = 0; i < positions.length; i += 3)
      bore = Math.min(bore, Math.hypot(positions[i]!, positions[i + 2]!))
    expect(2 * bore).toBeCloseTo(16.51, 2)
  })

  it('a 6.5 mm round diamond is about a carat', async () => {
    const e = await evaluate(evaluator, designFrom('other', [{ id: 'g', kind: 'gem', width: 6.5 }]))
    expect(e.stones[0]!.carat).toBeCloseTo(1.0, 1)
    expect(e.report.caratTotal).toBe(e.stones[0]!.carat)
    expect(e.report.lots).toMatchObject([
      { cut: 'round', stone: 'diamond', width: 6.5, count: 1, role: 'center' },
    ])
    // The instance matrix scales the unit mesh to the stone's real size.
    expect(e.stones[0]!.matrix[0]).toBeCloseTo(6.5, 6)
    expect(e.stones[0]!.dims.depth).toBeCloseTo(6.5 * 0.615, 6)
  })

  it('a measured stone overrides the nominal dimensions', async () => {
    const e = await evaluate(
      evaluator,
      designFrom('other', [
        {
          id: 'g',
          kind: 'gem',
          cut: 'oval',
          width: 6,
          sourcing: {
            provider: 'x',
            sku: '1',
            measured: { length: 8.31, width: 6.12, depth: 3.9 },
          },
        },
      ]),
    )
    expect(e.stones[0]!.dims).toEqual({ length: 8.31, width: 6.12, depth: 3.9 })
  })

  it('a 4 × 1.8 mm court band, US 9, weighs what a jeweller expects in 18k yellow', async () => {
    const design = template('wedding-band')
    const draft = await evaluate(evaluator, design)
    const production = await evaluate(evaluator, design, 'production')
    // Trade tables list a 4 mm court band in 18ct yellow at about 4 g (light, 1.2 mm), 5–6 g
    // (medium, ≈ 1.7 mm) and 7.5 g (heavy, 2.1 mm) around UK size R; this one tapers 1.8 → 1.6.
    expect(draft.report.metalMassG).toBeGreaterThan(4.8)
    expect(draft.report.metalMassG).toBeLessThan(6.5)
    expect(draft.parts[0]!.exact).toBe(true)
    // Exact volume: draft and production agree although their meshes differ.
    expect(production.report.metalMassG).toBeCloseTo(draft.report.metalMassG, 4)
    expect(draft.report.metals).toEqual([
      {
        material: 'au18k-yellow',
        volumeMm3: draft.parts[0]!.volumeMm3,
        massG: metalMassG('au18k-yellow', draft.parts[0]!.volumeMm3),
      },
    ])
    // Pappus: volume = cross-section area × path of its centroid; a court profile fills 75–88 %
    // of its 4 × 1.8 mm box and its centroid sits near mid-thickness.
    const boxed = 4 * 1.8 * Math.PI * (18.95 + 1.8)
    expect(draft.parts[0]!.volumeMm3 / boxed).toBeGreaterThan(0.72)
    expect(draft.parts[0]!.volumeMm3 / boxed).toBeLessThan(0.9)
  })

  it('the exact B-rep of a band has the volume the report states', async () => {
    const scene = await evaluator.scene(template('wedding-band'))
    const solid = scene.nodes.get('band')!.bodies[0]!.solid
    const { oc } = runtime()
    const props = new oc.GProp_GProps()
    oc.BRepGProp.VolumeProperties(solid.brep()!.wrapped, props, 1e-7, false, false)
    expect(props.Mass() / solid.volume()).toBeCloseTo(1, 5)
    props.delete()
  })

  it('cutting seats removes metal: production volume ≤ draft volume', async () => {
    for (const id of ['solitaire', 'halo', 'eternity']) {
      const draft = await evaluate(evaluator, template(id))
      const production = await evaluate(evaluator, template(id), 'production')
      expect(production.report.metalMassG, id).toBeLessThan(draft.report.metalMassG)
      expect(production.report.stoneCount).toBe(draft.report.stoneCount)
      // One watertight shell per alloy.
      expect(production.parts, id).toHaveLength(1)
    }
  })
})

describe('incremental evaluation', () => {
  it('returns identical results from cache and rebuilds only dependents', async () => {
    const design = template('halo')
    const first = await evaluate(evaluator, design)
    const again = await evaluate(evaluator, design)
    expect(Object.keys(again.timings).filter((k) => !k.startsWith('@'))).toEqual([])
    again.parts.forEach((part, i) => {
      expect(part.mesh).toBe(first.parts[i]!.mesh)
      expect(part.rev).toBe(first.parts[i]!.rev)
    })
    expect(again.report).toEqual(first.report)

    // The halo depends on the centre stone but not on the head or the band.
    const edited = applyOps(design, [
      { t: 'update', id: 'halo', patch: { stoneWidth: 1.5 } },
    ]).design
    const third = await evaluate(evaluator, edited)
    expect(Object.keys(third.timings).filter((k) => !k.startsWith('@'))).toEqual(['halo'])
    const rev = (e: typeof first, id: string) => e.parts.find((p) => p.nodeId === id)!.rev
    expect(rev(third, 'band')).toBe(rev(first, 'band'))
    expect(rev(third, 'halo')).not.toBe(rev(first, 'halo'))

    // Resizing the centre stone rebuilds everything that hangs off it, but not the band.
    const resized = applyOps(design, [{ t: 'update', id: 'center', patch: { width: 7 } }]).design
    const fourth = await evaluate(evaluator, resized)
    expect(
      Object.keys(fourth.timings)
        .filter((k) => !k.startsWith('@'))
        .sort(),
    ).toEqual(['center', 'halo', 'head'])
  })

  it('a feature that fails does not take the piece down with it', async () => {
    const design = designFrom('ring', [
      { id: 'band', kind: 'ringShank' },
      { id: 'bad', kind: 'revolve', profile: 'not a path' },
      { id: 'worse', kind: 'bail', host: 'bad' },
    ])
    const e = await evaluate(evaluator, design)
    expect(e.parts.map((p) => p.nodeId)).toEqual(['band'])
    expect(e.diagnostics.map((d) => [d.code, d.nodeId, d.level])).toEqual([
      ['feature.failed', 'bad', 'error'],
      ['feature.blocked', 'worse', 'warning'],
    ])
    expect(e.diagnostics[0]!.message).toMatch(/could not be built/)
  })

  it('aborts between nodes and stays usable', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(evaluator.scene(template('halo'), { signal: controller.signal })).rejects.toThrow()
    expect(failures(await evaluate(evaluator, template('halo')))).toEqual([])
  })

  it('hidden nodes and boolean operands leave the piece', async () => {
    const design = designFrom('other', [
      { id: 'a', kind: 'primitive', size: [6, 6, 3] },
      { id: 'b', kind: 'primitive', shape: 'cylinder', size: [3, 3, 8] },
      { id: 'cut', kind: 'boolean', target: 'a', tools: ['b'] },
      { id: 'ghost', kind: 'primitive', visible: false },
    ])
    const draft = await evaluate(evaluator, design)
    expect(draft.parts.map((p) => p.nodeId)).toEqual(['cut'])
    const production = await evaluate(evaluator, design, 'production')
    expect(production.parts).toHaveLength(1)
    expect(production.parts[0]!.exact).toBe(true)
    expect(production.parts[0]!.volumeMm3).toBeCloseTo(6 * 6 * 3 - Math.PI * 1.5 * 1.5 * 3, 2)
  })

  it('a body of separate shells stays one part; only shells that touch other metal are fused', async () => {
    const sphere = (id: string, x: number): NodeInput => ({
      id,
      kind: 'primitive',
      shape: 'sphere',
      size: [4, 4, 4],
      transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 },
    })
    const beads: NodeInput[] = [
      sphere('a', 0),
      sphere('b', 10),
      sphere('c', 20),
      { id: 'beads', kind: 'boolean', op: 'union', target: 'a', tools: ['b', 'c'] },
    ]
    const ball = (4 / 3) * Math.PI * 8
    const alone = await evaluate(evaluator, designFrom('other', [...beads]), 'production')
    expect(alone.parts.map((p) => [p.id, p.nodeId])).toEqual([['au18k-yellow:beads', 'beads']])
    expect(alone.parts[0]!.volumeMm3 / (3 * ball)).toBeCloseTo(1, 2)

    // A bar through the first bead: that bead fuses with the bar, the other two stay loose.
    const bar: NodeInput = { id: 'bar', kind: 'primitive', shape: 'box', size: [2, 2, 12] }
    const joined = await evaluate(evaluator, designFrom('other', [...beads, bar]), 'production')
    expect(joined.parts.map((p) => p.nodeId).sort()).toEqual(['bar', 'beads'])
    const loose = joined.parts.find((p) => p.id === 'au18k-yellow:beads')!
    expect(loose.volumeMm3 / (2 * ball)).toBeCloseTo(1, 2)
    expect(joined.report.metals[0]!.volumeMm3).toBeGreaterThan(3 * ball)
  })

  it('does not leak WASM memory over many evaluations', async () => {
    const design = template('solitaire')
    const heap = () => runtime().oc.wasmMemory.buffer.byteLength
    const sizes: number[] = []
    for (let i = 0; i < 300; i++) {
      const edited = applyOps(design, [
        { t: 'update', id: 'band', patch: { widthTop: 2 + (i % 10) * 0.05 } },
        { t: 'update', id: 'head', patch: { prongDiameter: 0.9 + (i % 7) * 0.05 } },
      ]).design
      // Every tenth round at production detail, and with the exact B-rep built.
      const scene = await evaluator.scene(edited, { detail: i % 10 === 0 ? 'production' : 'draft' })
      if (i % 10 === 0) scene.nodes.get('head')!.bodies[0]!.solid.brep()
      if (i % 50 === 49) sizes.push(heap())
    }
    // The heap may grow while caches warm up, but must be flat afterwards.
    expect(sizes[sizes.length - 1]).toBe(sizes[1])
  })
})

describe('templates', () => {
  // Rings, studs and the solitaire pendant; the freeform and chain templates are covered by
  // the tests of the features that build them.
  const ids = [
    'solitaire',
    'oval-pave',
    'halo',
    'three-stone',
    'wedding-band',
    'eternity',
    'signet',
    'pendant-solitaire',
    'studs',
    'cuban',
  ]
  it.each(ids)('%s evaluates at both detail levels without a failed feature', async (id) => {
    const kernel = createKernel()
    const design = template(id)
    for (const detail of ['draft', 'production'] as const) {
      const e = await kernel.evaluate(design, { detail })
      expect(failures(e), `${id} (${detail})`).toEqual([])
      // Kinds this build does not include are named, never silently dropped.
      const missing = Object.values(design.nodes).filter((n) => !kernel.kinds.includes(n.kind))
      expect(e.diagnostics.filter((d) => d.code === 'feature.unsupported')).toHaveLength(
        missing.length,
      )
      expect(e.parts.length, id).toBeGreaterThan(0)
      expect(e.report.metalMassG).toBeGreaterThan(0)
      for (const part of e.parts)
        expect(design.nodes[part.nodeId], `${id}: part ${part.id} names a node`).toBeDefined()
      if (detail === 'production')
        for (const part of e.parts)
          expect(castingFaults(part.mesh), `${id}: ${part.id}`).toEqual({
            openOrPinchedEdges: 0,
            collapsedTriangles: 0,
          })
    }
    kernel.dispose()
  })
})
