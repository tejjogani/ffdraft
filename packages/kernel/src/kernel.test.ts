import { designFrom, type NodeInput } from '@pave/schema'
import { makeSphere } from 'replicad'
import { describe, expect, it } from 'vitest'
import { solidFromBrep } from './core'
import { Evaluator } from './evaluate/evaluate'
import { primitive } from './features/primitive'
import { createKernel } from './kernel'
import { loadRuntime } from './runtime/index'

const box: NodeInput = { id: 'box', kind: 'primitive', shape: 'box', size: [4, 5, 6] }

describe('kernel core', () => {
  it('evaluates a primitive with exact volume', async () => {
    const kernel = createKernel()
    const e = await kernel.evaluate(designFrom('other', [box]))
    expect(e.diagnostics).toEqual([])
    expect(e.parts).toHaveLength(1)
    expect(e.parts[0]!.exact).toBe(true)
    expect(e.parts[0]!.volumeMm3).toBeCloseTo(120, 6)
    expect(e.report.metals[0]!.massG).toBeCloseTo(0.12 * 15.5, 6)
    expect(e.parts[0]!.mesh.indices.length).toBe(36)
    expect(e.parts[0]!.edges.length).toBe(12 * 6)
    kernel.dispose()
  })

  it('reports kinds that have no builder and keeps the rest', async () => {
    await loadRuntime()
    // A registry with one feature, so the test does not depend on which features have landed.
    const evaluator = new Evaluator([primitive])
    const design = designFrom('other', [box, { id: 'c', kind: 'bail', host: 'box' }])
    const { evaluation: e } = await evaluator.scene(design)
    expect(e.parts).toHaveLength(1)
    expect(e.diagnostics.map((d) => [d.code, d.nodeId, d.level])).toEqual([
      ['feature.unsupported', 'c', 'warning'],
    ])
    expect(evaluator.kinds).toEqual(['primitive'])
    evaluator.dispose()
  })

  it('moved and mirrored solids keep outward normals', async () => {
    await loadRuntime()
    const solid = solidFromBrep(makeSphere(2))
    const mirrored = solid.transformed([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1])
    for (const [s, centre] of [
      [solid, 0],
      [mirrored, 5],
    ] as const) {
      const { mesh } = s.tessellate()
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const [a, b, c] = [mesh.indices[t]! * 3, mesh.indices[t + 1]! * 3, mesh.indices[t + 2]! * 3]
        const p = (i: number, k: number) => mesh.positions[i + k]! - (k === 0 ? centre : 0)
        // The stored normal points away from the sphere's centre…
        expect(
          p(a, 0) * mesh.normals[a]! +
            p(a, 1) * mesh.normals[a + 1]! +
            p(a, 2) * mesh.normals[a + 2]!,
        ).toBeGreaterThan(0)
        // …and so does the triangle's winding (triangles at the poles have no area).
        const u = [0, 1, 2].map((k) => p(b, k) - p(a, k))
        const v = [0, 1, 2].map((k) => p(c, k) - p(a, k))
        const n = [
          u[1]! * v[2]! - u[2]! * v[1]!,
          u[2]! * v[0]! - u[0]! * v[2]!,
          u[0]! * v[1]! - u[1]! * v[0]!,
        ]
        expect(n[0]! * p(a, 0) + n[1]! * p(a, 1) + n[2]! * p(a, 2)).toBeGreaterThanOrEqual(0)
      }
      expect(s.volume()).toBeCloseTo((4 / 3) * Math.PI * 8, 6)
    }
    mirrored.dispose()
    solid.dispose()
  })

  it('fuses per metal at production and caches unchanged nodes', async () => {
    const kernel = createKernel()
    const ball: NodeInput = {
      id: 'ball',
      kind: 'primitive',
      shape: 'sphere',
      size: [4, 4, 4],
      transform: { position: [0, 0, 3], rotation: [0, 0, 0], scale: 1 },
    }
    const design = designFrom('other', [box, ball])
    const draft = await kernel.evaluate(design)
    expect(draft.parts).toHaveLength(2)
    const prod = await kernel.evaluate(design, { detail: 'production' })
    expect(prod.parts).toHaveLength(1)
    expect(prod.report.metals[0]!.volumeMm3).toBeLessThan(draft.report.metals[0]!.volumeMm3)
    const again = await kernel.evaluate(design)
    expect(Object.keys(again.timings).filter((k) => !k.startsWith('@'))).toEqual([])
    expect(again.parts[0]!.mesh).toBe(draft.parts[0]!.mesh)
    kernel.dispose()
  })
})
