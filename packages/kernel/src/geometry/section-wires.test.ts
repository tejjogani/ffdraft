import { designFrom } from '@pave/schema'
import { beforeAll, expect, it } from 'vitest'
import { loadRuntime } from '../runtime/index'
import { scoped } from '../solid/occt'
import { curveWire } from './section-wires'
import { composeTransform, IDENTITY } from './vec'

beforeAll(() => loadRuntime())

it('builds a construction wire from its placed, ordered segments', () => {
  const { nodes } = designFrom('other', [
    {
      id: 'section',
      kind: 'curve',
      plane: 'right',
      closed: true,
      points: [
        { id: 'a', u: 0, v: 0 },
        { id: 'b', u: 3, v: 0 },
        { id: 'c', u: 3, v: 4 },
      ],
    },
  ])
  const matrix = composeTransform([5, 10, 15], [0, 0, 90], 2)
  scoped((own) => {
    const { wire, closed } = curveWire({ node: nodes.section!, matrix }, own)
    expect(closed).toBe(true)
    expect(wire.length).toBeCloseTo(24, 8)
    const bounds = own(wire.boundingBox).bounds
    expect(bounds[0][0]).toBeCloseTo(-1, 6)
    expect(bounds[0][1]).toBeCloseTo(10, 6)
    expect(bounds[1][2]).toBeCloseTo(23, 6)
  })
})

it('retains NURBS rational weights in the exact wire', () => {
  const { nodes } = designFrom('other', [
    {
      id: 'section',
      kind: 'nurbsCurve',
      degree: 2,
      knots: [0, 0, 1, 1],
      controlPoints: [
        [1, 0, 0, 1],
        [1, 1, 0, Math.SQRT1_2],
        [0, 1, 0, 1],
      ],
    },
  ])
  const matrix = composeTransform([5, 10, 15], [0, 0, 0], 2)
  scoped((own) => {
    const { wire, closed } = curveWire({ node: nodes.section!, matrix }, own)
    expect(closed).toBe(false)
    const midpoint = own(wire.pointAt(0.5)).toTuple()
    expect(midpoint[0]).toBeCloseTo(5 + Math.SQRT2, 8)
    expect(midpoint[1]).toBeCloseTo(10 + Math.SQRT2, 8)
    expect(midpoint[2]).toBeCloseTo(15, 8)
  })
})

it('retains the Rhino domain of an unclamped NURBS', () => {
  const { nodes } = designFrom('other', [
    {
      id: 'section',
      kind: 'nurbsCurve',
      degree: 2,
      knots: [-1, 0, 1, 2, 3, 4],
      controlPoints: [
        [0, 0, 0, 1],
        [2, 0, 0, 1],
        [2, 4, 0, 1],
        [0, 4, 0, 1],
        [0, 0, 0, 1],
      ],
    },
  ])
  scoped((own) => {
    const { wire, closed } = curveWire({ node: nodes.section!, matrix: IDENTITY }, own)
    expect(closed).toBe(false)
    expect(own(wire.startPoint).toTuple()).toEqual([1, 0, 0])
    expect(own(wire.endPoint).toTuple()).toEqual([0, 2, 0])
  })
})
