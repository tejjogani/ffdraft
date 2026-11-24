/**
 * The evaluator on schema-valid input that used to throw, hang or return broken solids: every
 * such case must end as a diagnostic on the node responsible, never as a raw error.
 */
import { type Design, designFrom, type NodeInput } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defineFeature, lazySolid, metalOf } from '../core'
import { createKernel, type LocalKernel } from '../kernel'
import { isRuntimeFault } from '../runtime/index'
import { surfaceDefects, weld } from '../solid/meshing'
import { CORE_FEATURES, coreEvaluator } from '../testing/core'
import { Evaluator } from './evaluate'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

const codes = (e: { diagnostics: { code: string }[] }) => e.diagnostics.map((d) => d.code)
const failedMessage = (
  e: { diagnostics: { code: string; nodeId?: string; message: string }[] },
  id: string,
) => e.diagnostics.find((d) => d.code === 'feature.failed' && d.nodeId === id)?.message

describe('closed solids', () => {
  it('meshes an ellipsoid primitive into a closed solid at both details', async () => {
    const design = designFrom('other', [
      { id: 'ball', kind: 'primitive', shape: 'sphere', size: [8, 6, 4] },
      { id: 'ring', kind: 'finding', type: 'jumpRing', host: 'ball' },
    ])
    for (const detail of ['draft', 'production'] as const) {
      const scene = await kernel.scene(design, { detail })
      expect(codes(scene.evaluation)).not.toContain('feature.failed')
      const ball = scene.nodes.get('ball')!.bodies[0]!.solid
      expect(surfaceDefects(ball.triangles(scene.quality))).toEqual({ open: 0, nonManifold: 0 })
      // 4/3 π · 4 · 3 · 2
      expect(ball.volume()).toBeCloseTo(100.53, 1)
    }
  })

  it('welds pole vertices that differ only by floating-point dust around zero', () => {
    const positions = new Float32Array([2.4e-16, 0, 1, -1.2e-16, 1.6e-16, 1, 1, 0, 0])
    const welded = weld(positions, new Uint32Array([0, 1, 2]))
    // The two pole vertices merge, so the sliver triangle collapses and is dropped.
    expect(welded.positions.length / 3).toBe(2)
    expect(welded.indices.length).toBe(0)
  })

  it('rejects revolve profiles that enclose no area or cross themselves, with the reason', async () => {
    const cases: [string, RegExp][] = [
      ['M 0 0 L 0 5 Z', /encloses no area/],
      ['M 0 0 L 5 0', /encloses no area/],
      ['M 1 0 L 5 5 L 5 0 L 1 5 Z', /crosses itself/],
    ]
    for (const [profile, reason] of cases) {
      const e = await kernel.evaluate(designFrom('other', [{ id: 'r', kind: 'revolve', profile }]))
      expect(failedMessage(e, 'r')).toMatch(reason)
      expect(e.parts).toHaveLength(0)
    }
  })

  it('fails only the node whose feature returns an open surface', async () => {
    // A feature that hands back an open mesh (one triangle), like a bad import or recipe.
    const broken = defineFeature('primitive', (node) => ({
      bodies: [
        {
          solid: lazySolid({
            mesh: () => ({
              positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
              indices: new Uint32Array([0, 1, 2]),
            }),
          }),
          ...metalOf(node),
        },
      ],
    }))
    const evaluator = new Evaluator([
      ...CORE_FEATURES.filter((f) => f.kind !== 'primitive'),
      broken,
    ])
    const design = designFrom('ring', [
      { id: 'band', kind: 'ringShank' },
      { id: 'bad', kind: 'primitive' },
    ])
    for (const detail of ['draft', 'production'] as const) {
      const e = (await evaluator.scene(design, { detail })).evaluation
      expect(failedMessage(e, 'bad')).toMatch(/not a closed solid/)
      expect(e.parts.length).toBeGreaterThan(0)
    }
    evaluator.dispose()
  })
})

describe('limits', () => {
  it('stops a runaway nested pattern at the triangle limit instead of hanging', async () => {
    const design = designFrom('other', [
      { id: 'ball', kind: 'primitive', shape: 'sphere', size: [1, 1, 1] },
      {
        id: 'p1',
        kind: 'pattern',
        sources: ['ball'],
        type: 'linear',
        axis: 'x',
        count: 200,
        spacing: 1.5,
      },
      {
        id: 'p2',
        kind: 'pattern',
        sources: ['p1'],
        type: 'linear',
        axis: 'z',
        count: 200,
        spacing: 1.5,
      },
    ] as NodeInput[])
    const started = performance.now()
    const e = await kernel.evaluate(design)
    expect(failedMessage(e, 'p2')).toMatch(/more than 2,000,000 triangles/)
    expect(codes(e).filter((c) => c === 'feature.failed')).toHaveLength(1)
    expect(performance.now() - started).toBeLessThan(30_000)
  })

  it('evaluates very many stones without overflowing the call stack, and caps a node', async () => {
    const design = designFrom('other', [
      { id: 'g', kind: 'gem', width: 1 },
      {
        id: 'p1',
        kind: 'pattern',
        sources: ['g'],
        type: 'linear',
        axis: 'x',
        count: 200,
        spacing: 1.5,
      },
      {
        id: 'p2',
        kind: 'pattern',
        sources: ['p1'],
        type: 'linear',
        axis: 'z',
        count: 200,
        spacing: 1.5,
      },
      {
        id: 'p3',
        kind: 'pattern',
        sources: ['p2'],
        type: 'linear',
        axis: 'y',
        count: 4,
        spacing: 3,
      },
    ] as NodeInput[])
    const e = await kernel.evaluate(design)
    expect(failedMessage(e, 'p3')).toMatch(/places [\d,]{7} stones; the limit is 50,000/)
    // Everything else, some 39 800 stones, is instanced and checked (no spread into Math.max).
    expect(e.stones.length).toBeGreaterThan(39_000)
  })
})

describe('a corrupt document', () => {
  it('skips order entries with no node and evaluates nodes missing from the order', async () => {
    const base = designFrom('ring', [{ id: 'band', kind: 'ringShank' }])
    const design: Design = {
      ...base,
      nodes: { ...base.nodes, extra: { ...base.nodes.band!, id: 'extra', name: 'Extra' } },
      order: ['ghost', 'band'],
    }
    const e = await kernel.evaluate(design)
    expect(codes(e)).toContain('design.missingNode')
    expect(e.diagnostics.find((d) => d.code === 'design.unlisted')?.nodeId).toBe('extra')
    expect(e.parts.map((p) => p.nodeId).sort()).toEqual(['band', 'extra'])
  })
})

describe('a fault inside a WASM runtime', () => {
  it('is reported readably and the kernel works again afterwards', async () => {
    const evaluator = await coreEvaluator()
    const fault = new WebAssembly.RuntimeError('table index is out of bounds')
    expect(isRuntimeFault(fault)).toBe(true)
    await expect(
      evaluator.guarded(async () => {
        throw fault
      }),
    ).rejects.toThrow(/ran out of room on this design and was restarted/)
    // The faulted runtime was dropped; a kernel loads a fresh one and evaluates normally.
    const e = await kernel.evaluate(designFrom('ring', [{ id: 'band', kind: 'ringShank' }]))
    expect(e.parts).toHaveLength(1)
    expect(codes(e)).not.toContain('feature.failed')
  })
})
