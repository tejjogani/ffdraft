import { makeBaseBox, makeCylinder } from 'replicad'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadRuntime } from '../runtime/index'
import { subtract } from './boolean'
import { solidFromBrep, withSolidScope } from './solid'

beforeAll(async () => {
  await loadRuntime()
})

describe('exact subtraction with several cutters', () => {
  it('leaves the cutters intact, so the same cut gives the same exact result again', async () => {
    await withSolidScope(
      () => {
        const block = solidFromBrep(makeBaseBox(20, 6, 4))
        // Three disjoint drills: an exact compound cut.
        const drills = [-6, 0, 6].map((x) =>
          solidFromBrep(makeCylinder(1, 10, [x, 0, -5], [0, 0, 1])),
        )
        const volumes = [0, 1].map(() => {
          const cut = subtract(block, drills)
          expect(cut.exact).toBe(true)
          return cut.volume()
        })
        expect(volumes[1]).toBeCloseTo(volumes[0]!, 6)
        expect(volumes[0]).toBeCloseTo(20 * 6 * 4 - 3 * Math.PI * 4, 3)
        // The cutters still have their B-reps (replicad's makeCompound used to delete them).
        for (const d of drills) expect(d.volume()).toBeCloseTo(Math.PI * 10, 3)
        return null
      },
      () => [],
    )
  })
})
