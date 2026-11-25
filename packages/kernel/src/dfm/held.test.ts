import { buildDesign, TEMPLATES } from '@pave/schema'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createKernel } from '../kernel'

/** Counts the triangles every search tree is asked for, without changing what the trees do. */
const treed: number[] = []
vi.mock('./trees', async (importOriginal) => {
  const real = await importOriginal<typeof import('./trees')>()
  return {
    ...real,
    treeOf: (mesh: Parameters<typeof real.treeOf>[0]) => {
      treed.push(mesh.indices.length / 3)
      return real.treeOf(mesh)
    },
  }
})

const kernel = createKernel()
afterAll(() => kernel.dispose())

describe('stones held by their chain', () => {
  it('are not searched for at draft, so a tennis bracelet edit builds no tree of the chain', async () => {
    const tennis = buildDesign(TEMPLATES.find((t) => t.id === 'tennis')!.spec)
    treed.length = 0
    const draft = await kernel.evaluate(tennis)
    expect(draft.stones.length).toBeGreaterThan(20)
    expect(treed).toEqual([])
    expect(draft.diagnostics.map((d) => d.code)).not.toContain('stone.unheld')
  })
})
