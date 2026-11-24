import { buildDesign } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createKernel, type LocalKernel } from '../../kernel'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

describe('earring post on an open bezel', () => {
  it.each(['bezel', 'halfBezel', 'flush'] as const)(
    'closes the back of a %s stud so the post casts with it',
    async (setting) => {
      const e = await kernel.evaluate(
        buildDesign({
          kind: 'earrings',
          archetype: 'studs',
          title: 's',
          summary: 's',
          stones: [
            {
              role: 'center',
              cut: setting === 'halfBezel' ? 'oval' : 'round',
              carat: 0.25,
              setting,
            },
          ],
        }),
        { detail: 'production' },
      )
      expect(e.diagnostics.filter((d) => d.level !== 'info')).toEqual([])
      // One casting per earring: the head with its post.
      expect(e.parts).toHaveLength(2)
    },
    60_000,
  )
})
