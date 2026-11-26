import { applyOps, designFrom } from '@pave/schema'
import { afterAll, expect, it } from 'vitest'
import { createKernel } from '../kernel'

const kernel = createKernel()
afterAll(() => kernel.dispose())

it('evaluates a design.apply curve in world millimetres without adding metal', async () => {
  const { design } = applyOps(designFrom('other', []), [
    {
      t: 'add',
      node: {
        id: 'guide',
        kind: 'curve',
        plane: 'right',
        points: [
          { id: 'a', u: 2, v: 1 },
          { id: 'b', u: 8, v: 3 },
          { id: 'c', u: 12, v: 2 },
        ],
      },
    },
  ])
  const evaluation = await kernel.evaluate(design)
  expect(evaluation.curves).toEqual([
    {
      nodeId: 'guide',
      plane: 'right',
      points: [
        [0, 2, 1],
        [0, 8, 3],
        [0, 12, 2],
      ],
      closed: false,
    },
  ])
  expect(evaluation.parts).toEqual([])
  expect(evaluation.report.metalMassG).toBe(0)
  expect(evaluation.diagnostics.some((d) => d.level === 'error')).toBe(false)

  const changed = applyOps(design, [
    {
      t: 'update',
      id: 'guide',
      patch: {
        points: [
          { id: 'a', u: 2, v: 1 },
          { id: 'b', u: 9, v: 4 },
          { id: 'c', u: 12, v: 2 },
        ],
      },
    },
  ]).design
  expect((await kernel.evaluate(changed)).curves?.[0]?.points[1]).toEqual([0, 9, 4])
})

it('refuses a closed construction curve with fewer than three different points', () => {
  expect(() =>
    designFrom('other', [
      {
        id: 'guide',
        kind: 'curve',
        plane: 'front',
        closed: true,
        points: [
          { id: 'a', u: 2, v: 1 },
          { id: 'b', u: 8, v: 3 },
        ],
      },
    ]),
  ).toThrow(/three/i)
})
