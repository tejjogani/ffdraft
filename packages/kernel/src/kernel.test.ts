import { type NodeInput, designFrom } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { createKernel } from './kernel'

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

  it('reports unsupported kinds and keeps the rest', async () => {
    const kernel = createKernel()
    const e = await kernel.evaluate(
      designFrom('other', [box, { id: 'c', kind: 'chain', style: 'cable' }]),
    )
    expect(e.parts).toHaveLength(1)
    expect(e.diagnostics.map((d) => d.code)).toEqual(['feature.unsupported'])
    expect(kernel.kinds).not.toContain('chain')
    kernel.dispose()
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
