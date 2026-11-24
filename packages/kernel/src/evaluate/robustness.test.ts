/**
 * The evaluator on schema-valid input that used to throw, hang or return broken solids: every
 * such case must end as a diagnostic on the node responsible, never as a raw error.
 */
import {
  applyOps,
  buildDesign,
  type Design,
  designFrom,
  type NodeInput,
  TEMPLATES,
} from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defineFeature, lazySolid, metalOf } from '../core'
import { createKernel, type LocalKernel } from '../kernel'
import { isRuntimeFault, runtimeGeneration } from '../runtime/index'
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

describe('evaluations that go wrong halfway', () => {
  /** A signal that aborts itself at its n-th check, as a Worker abort arriving mid-build would. */
  const abortAt = (n: number): AbortSignal => {
    const controller = new AbortController()
    const { signal } = controller
    const check = signal.throwIfAborted.bind(signal)
    let calls = 0
    signal.throwIfAborted = () => {
      if (++calls === n) controller.abort()
      check()
    }
    return signal
  }
  const template = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)

  it('an aborted edit does not leave the earlier design pointing at freed solids', async () => {
    const own = createKernel()
    const a = template('solitaire')
    const b = applyOps(a, [{ t: 'update', id: 'band', patch: { thicknessTop: 2.3 } }]).design
    await own.scene(a, { detail: 'production' })
    // Aborted after the band was rebuilt for B (its A result freed), before assembly.
    await expect(own.evaluate(b, { detail: 'production', signal: abortAt(3) })).rejects.toThrow()
    const again = await own.scene(a, { detail: 'production' })
    for (const part of again.parts) for (const s of part.sources) expect(() => s.body.solid.bounds()).not.toThrow()
    const step = await own.export(a, 'step')
    expect(step.bytes.length).toBeGreaterThan(1000)
    own.dispose()
  }, 120_000)

  it('a WASM fault inside a node build restarts the runtime instead of being cached', async () => {
    const own = createKernel()
    await own.ready()
    const design = designFrom('pendant', [
      { id: 'm', kind: 'meshBody', source: { type: 'asset', assetId: 'x' }, height: 12 } as NodeInput,
    ])
    const before = runtimeGeneration()
    const faulting = async (): Promise<Uint8Array> => {
      throw new WebAssembly.RuntimeError('memory access out of bounds')
    }
    await expect(own.evaluate(design, { assets: faulting })).rejects.toThrow(/was restarted/)
    expect(runtimeGeneration()).toBe(before + 1)
    own.dispose()
  })

  it('a fault in one kernel does not break the warm solids of another in the same thread', async () => {
    const b = createKernel()
    const halo = template('halo')
    await b.evaluate(halo, { detail: 'production' })
    const a = await coreEvaluator()
    await expect(
      a.guarded(async () => {
        throw new WebAssembly.RuntimeError('table index is out of bounds')
      }),
    ).rejects.toThrow(/restarted/)
    const edited = applyOps(halo, [{ t: 'update', id: 'head', patch: { prongCount: 6 } }]).design
    const e = await b.evaluate(edited, { detail: 'production' })
    expect(codes(e).filter((c) => c.startsWith('feature.'))).toEqual([])
    expect((await b.export(edited, 'stl')).bytes.length).toBeGreaterThan(1000)
    b.dispose()
  }, 120_000)

  it('two kernels evaluating at once in one thread both succeed', async () => {
    const one = createKernel()
    const two = createKernel()
    const halo = template('halo')
    const [x, y] = await Promise.all([one.evaluate(halo), two.evaluate(halo)])
    for (const e of [x, y]) expect(codes(e).filter((c) => c.startsWith('feature.'))).toEqual([])
    one.dispose()
    two.dispose()
  })

  it('an asset that failed to load is fetched again on the next evaluation', async () => {
    const own = createKernel()
    const design = designFrom('pendant', [
      { id: 'm', kind: 'meshBody', source: { type: 'asset', assetId: 'cube' }, height: 10 } as NodeInput,
    ])
    // Without a store, then with one that is down, then with one that works.
    expect(failedMessage(await own.evaluate(design), 'm')).toMatch(/No asset store/)
    let calls = 0
    const down = async (): Promise<Uint8Array> => {
      calls++
      throw new Error('503 from the asset store')
    }
    expect(failedMessage(await own.evaluate(design, { assets: down }), 'm')).toMatch(/503/)
    const cube = new TextEncoder().encode(
      'solid c\n' +
        [
          [0, 1, 2, 0, 2, 3],
          [4, 6, 5, 4, 7, 6],
          [0, 4, 5, 0, 5, 1],
          [1, 5, 6, 1, 6, 2],
          [2, 6, 7, 2, 7, 3],
          [3, 7, 4, 3, 4, 0],
        ]
          .flatMap((f) => [f.slice(0, 3), f.slice(3)])
          .map((t) => {
            const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]
            // Outward winding for the bottom face reversed, so every face points out.
            const tri = t[0] === 0 && t[1] === 1 ? [t[0], t[2], t[1]] : t
            return `facet normal 0 0 0\nouter loop\n${tri.map((i) => `vertex ${v[i!]!.join(' ')}`).join('\n')}\nendloop\nendfacet`
          })
          .join('\n') +
        '\nendsolid c\n',
    )
    const up = async (): Promise<Uint8Array> => {
      calls++
      return cube
    }
    const e = await own.evaluate(design, { assets: up })
    expect(calls).toBe(2)
    expect(e.timings.m).toBeDefined()
    own.dispose()
  })
})

describe('edits that change no geometry', () => {
  const template = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)

  it('a rename rebuilds nothing and the new name reaches parts and messages', async () => {
    const own = createKernel()
    const design = template('solitaire')
    await own.evaluate(design)
    const renamed = applyOps(design, [{ t: 'update', id: 'band', patch: { name: 'Shank' } }]).design
    const e = await own.evaluate(renamed)
    expect(Object.keys(e.timings).filter((k) => !k.startsWith('@'))).toEqual([])
    expect(e.parts.find((p) => p.nodeId === 'band')?.name).toBe('Shank')
    own.dispose()
  })

  it('the same nodes with their keys in another order rebuild nothing', async () => {
    const own = createKernel()
    const design = template('signet')
    await own.evaluate(design)
    const reordered = {
      ...design,
      nodes: Object.fromEntries(
        Object.entries(design.nodes).map(([id, node]) => [
          id,
          Object.fromEntries(Object.entries(node).reverse()),
        ]),
      ),
    } as Design
    const e = await own.evaluate(reordered)
    expect(Object.keys(e.timings).filter((k) => !k.startsWith('@'))).toEqual([])
    own.dispose()
  })
})

describe('copies that coincide', () => {
  it('a polar pattern stacked on its source is fused in no time and reported', async () => {
    const design = designFrom('other', [
      { id: 'a', kind: 'primitive', shape: 'sphere', size: [10, 10, 10] },
      { id: 'p', kind: 'pattern', sources: ['a'], type: 'polar', axis: 'y', count: 8 } as NodeInput,
    ])
    const e = await kernel.evaluate(design)
    expect(e.timings['@assemble']).toBeLessThan(500)
    expect(e.diagnostics.find((d) => d.code === 'pattern.coincident')?.nodeId).toBe('p')
    // A copy adds no metal: the pattern weighs what one ball weighs.
    const [one, pattern] = e.parts.map((p) => p.volumeMm3)
    expect(pattern).toBeCloseTo(one!, 3)
  })
})

describe('documents that are not valid designs', () => {
  it('are rejected readably, or lose only the invalid node', async () => {
    await expect(kernel.evaluate({} as Design)).rejects.toThrow(/not a Pavé design/)
    const base = designFrom('ring', [
      { id: 'band', kind: 'ringShank' },
      { id: 'g', kind: 'gem', placement: { type: 'ringTop', shank: 'band' } },
    ])
    const bad = {
      ...base,
      nodes: { ...base.nodes, band: { ...base.nodes.band!, thicknessTop: '2' } },
    } as unknown as Design
    const e = await kernel.evaluate(bad)
    expect(e.diagnostics.find((d) => d.code === 'design.invalid')?.nodeId).toBe('band')
    expect(e.diagnostics.find((d) => d.nodeId === 'g')?.code).toBe('feature.blocked')
  })
})

describe('selective finishing', () => {
  it('a casting takes the finish most of its metal has, whichever node comes first', async () => {
    // A small plated stud first, then the large bare body it is fused to.
    const design = designFrom('other', [
      { id: 'stud', kind: 'primitive', shape: 'box', size: [2, 2, 2], plating: 'rhodium' },
      { id: 'body', kind: 'primitive', shape: 'sphere', size: [10, 10, 10] } as NodeInput,
    ])
    const [part] = (await kernel.evaluate(design, { detail: 'production' })).parts
    expect(part?.plating).toBe('none')
    expect(part?.regions?.map((r) => [r.nodeId, r.plating])).toEqual([['stud', 'rhodium']])
  })
})
