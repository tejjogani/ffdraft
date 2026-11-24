import { describe, expect, it } from 'vitest'
import { project } from './camera'
import { liftToSurface, stonesFromMarks } from './lift'
import { boxMesh, fakeEvaluation, sphereMesh } from './testkit'
import type { Camera } from './types'

const cam: Camera = {
  azimuth: 20,
  elevation: 30,
  roll: 0,
  distance: 120,
  span: 30,
  shift: [0, 0],
  target: [0, 0, 0],
}
const size = { width: 128, height: 128 }

describe('lift', () => {
  it('puts image points back on the host surface with its normal, and nothing off it', () => {
    const e = fakeEvaluation([
      { nodeId: 'body', mesh: sphereMesh([0, 0, 0], 8, 64) },
      { nodeId: 'other', mesh: boxMesh([9, -1, -1], [11, 1, 1]) },
    ])
    const truth: [number, number, number][] = [
      [0, -8, 0],
      [Math.SQRT1_2 * -8, Math.SQRT1_2 * -8 * 0.6, 8 * 0.4],
      [0, 0, 8],
    ]
    const visible = truth.map((p) => {
      const n = Math.hypot(...p)
      return p.map((v) => (v / n) * 8) as [number, number, number]
    })
    const px = visible.map((p) => project(cam, size, p))
    const lifted = liftToSurface(e, cam, size, [...px, { x: 1, y: 1 }], 'body')
    for (let i = 0; i < visible.length; i++) {
      const l = lifted[i]!
      expect(
        Math.hypot(
          l.point[0] - visible[i]![0],
          l.point[1] - visible[i]![1],
          l.point[2] - visible[i]![2],
        ),
      ).toBeLessThan(0.1)
      const n = visible[i]!.map((v) => v / 8)
      expect(l.normal[0] * n[0]! + l.normal[1] * n[1]! + l.normal[2] * n[2]!).toBeGreaterThan(0.99)
    }
    expect(lifted[3]).toBeNull()
  })

  it('turns marks and lifts into surface-placed stones snapped to melee', () => {
    const s = stonesFromMarks(
      [
        { x: 1, y: 1, d: 12.6 },
        { x: 2, y: 2, d: 10 },
      ],
      [{ point: [1, 2, 3], normal: [0, -1, 0] }, null],
      0.1,
      'body',
    )
    expect(s).toEqual([
      {
        width: 1.25,
        placement: { type: 'surface', host: 'body', point: [1, 2, 3], normal: [0, -1, 0] },
      },
    ])
  })
})
