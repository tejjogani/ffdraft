import type { EvaluatedCurve } from '@pave/kernel'
import type { Vec3 } from '@pave/render'
import { expect, it } from 'vitest'
import { snapCurve } from './snapping'

const curve: EvaluatedCurve = {
  nodeId: 'guide',
  plane: 'front',
  points: [
    [0, 0, 0],
    [10, 0, 0],
    [10, 0, 10],
  ],
  closed: false,
}
const project = ([x, , z]: Vec3) => ({ x: x * 10, y: z * 10, visible: true })

it('snaps to the nearest endpoint or midpoint on the active plane in screen pixels', () => {
  expect(snapCurve([curve], 'front', { x: 52, y: 3 }, project)).toMatchObject({
    point: [5, 0],
    label: 'Midpoint',
  })
  expect(snapCurve([curve], 'front', { x: 103, y: 104 }, project)).toMatchObject({
    point: [10, 10],
    label: 'Endpoint',
  })
  expect(snapCurve([curve], 'top', { x: 52, y: 3 }, project)).toBeNull()
  expect(snapCurve([curve], 'front', { x: 50, y: 16 }, project)).toBeNull()
})
