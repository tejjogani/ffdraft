import { describe, expect, it } from 'vitest'
import { designFrom, type NodeInputOf } from '../index'
import { pointOnNurbs, sampleNurbs, withNurbsPoint } from './nurbs'

const quarter: NodeInputOf<'nurbsCurve'> = {
  kind: 'nurbsCurve',
  id: 'arc',
  degree: 2,
  knots: [2, 2, 6, 6],
  controlPoints: [
    [2, 0, 1, 1],
    [2, 2, 1, Math.SQRT1_2],
    [0, 2, 1, 1],
  ],
}
describe('native curve controls', () => {
  it('evaluates a weighted quarter-circle on its original domain', () => {
    const node = designFrom('other', [quarter]).nodes.arc!
    if (node.kind !== 'nurbsCurve') throw Error('Expected a NURBS curve')
    const [x, y, z] = pointOnNurbs(node, 4)
    expect(x).toBeCloseTo(Math.SQRT2, 12)
    expect(y).toBeCloseTo(Math.SQRT2, 12)
    expect(z).toBeCloseTo(1, 12)
    const samples = sampleNurbs(node)
    expect(samples[0]).toEqual([2, 0, 1])
    expect(samples.at(-1)).toEqual([0, 2, 1])
    expect(samples.length).toBeGreaterThan(3)
    for (const [xx, yy] of samples) expect(Math.hypot(xx, yy)).toBeCloseTo(2, 9)
  })
  it('moves the duplicated seam on a closed outline without moving the adjacent points', () => {
    const input = designFrom('other', [
      {
        id: 'rail',
        kind: 'nurbsCurve',
        degree: 1,
        knots: [0, 1, 2, 3],
        controlPoints: [
          [1, 0, 0, 1],
          [0, 2, 0, 1],
          [-1, 0, 0, 1],
          [1, 0, 0, 1],
        ],
      },
    ])
    const node = input.nodes.rail!
    if (node.kind !== 'nurbsCurve') throw Error('Expected a NURBS curve')
    expect(withNurbsPoint(node, 3, [2, 0, 0, 1])).toEqual([
      [2, 0, 0, 1],
      [0, 2, 0, 1],
      [-1, 0, 0, 1],
      [2, 0, 0, 1],
    ])
  })
  it('rejects invalid knot counts, reversed knots and empty parameter spans', () => {
    for (const knots of [
      [2, 6],
      [2, 1, 6, 6],
      [2, 2, 2, 2],
    ])
      expect(() => designFrom('other', [{ ...quarter, knots }])).toThrow()
  })
})
