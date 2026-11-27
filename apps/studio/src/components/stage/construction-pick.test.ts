import type { EvaluatedCurve } from '@pave/kernel'
import type { Vec3 } from '@pave/render'
import { describe, expect, it } from 'vitest'
import { pickConstructionCurve } from './construction-pick'

const project = ([x, y, depth]: Vec3) => ({ x, y, inFront: depth > 0 })

const curve = (nodeId: string, points: Vec3[], closed = false): EvaluatedCurve => ({
  nodeId,
  points,
  closed,
})

describe('construction-curve picking', () => {
  it('chooses the nearer visible segment even when the curve came later', () => {
    const curves = [
      curve('far', [
        [0, 11, 1],
        [10, 11, 1],
      ]),
      curve('near', [
        [0, 8, 1],
        [10, 8, 1],
      ]),
    ]
    expect(pickConstructionCurve({ x: 5, y: 7 }, curves, project, () => true)).toEqual({
      nodeId: 'near',
    })
  })

  it('includes the closing segment of a closed curve', () => {
    const pts: Vec3[] = [
      [0, 0, 1],
      [20, 0, 1],
      [20, 20, 1],
    ]
    expect(
      pickConstructionCurve({ x: 10, y: 10 }, [curve('closed', pts, true)], project, () => true),
    ).toEqual({ nodeId: 'closed' })
    expect(
      pickConstructionCurve({ x: 10, y: 10 }, [curve('open', pts)], project, () => true),
    ).toBeNull()
  })

  it('ignores hidden curves and segments behind the camera', () => {
    const curves = [
      curve('hidden', [
        [0, 2, 1],
        [10, 2, 1],
      ]),
      curve('behind', [
        [0, 2, -1],
        [10, 2, -1],
      ]),
    ]
    expect(
      pickConstructionCurve({ x: 5, y: 2 }, curves, project, ({ nodeId }) => nodeId !== 'hidden'),
    ).toBeNull()
  })
})
