import { writeStl } from '@pave/kernel/mesh-stl'
import { Euler, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { measureRhinoRoleBody } from './role-measurements'

const ring = [
  [-1, -2, 0],
  [1, -2, 0],
  [1, 2, 0],
  [-1, 2, 0],
  [-0.95, -1.95, 0.4],
  [0.95, -1.95, 0.4],
  [0.95, 1.95, 0.4],
  [-0.95, 1.95, 0.4],
  [0, 0, -1],
]
const faces = [4, 5, 6, 4, 6, 7]
for (let i = 0; i < 4; i++) {
  const j = (i + 1) % 4
  faces.push(i, j, 4 + i, j, 4 + j, 4 + i, j, i, 8)
}
it('measures an individually tilted and translated stone in its table plane', () => {
  const pose = new Euler(0.6, -0.3, 0.96)
  const at = new Vector3(16, 5, -3)
  const positions = Float32Array.from(
    ring.flatMap(([x, y, z]) => new Vector3(x, y, z).applyEuler(pose).add(at).toArray()),
  )
  const file = writeStl([{ positions, indices: Uint32Array.from(faces) }], 'fictional')
  const m = measureRhinoRoleBody(file.buffer, 'emerald')!
  expect(m.width).toBeCloseTo(2, 4)
  expect(m.length).toBeCloseTo(4, 4)
  expect(m.depth).toBeCloseTo(1.4, 4)
  expect(new Vector3(...m.girdle).distanceTo(at)).toBeLessThan(0.01)
  const overridden = measureRhinoRoleBody(
    file.buffer,
    'emerald',
    pose
      .toArray()
      .slice(0, 3)
      .map((v) => (Number(v) * 180) / Math.PI) as [number, number, number],
  )!
  expect(overridden.width).toBeCloseTo(2, 4)
  expect(overridden.girdle).toEqual(expect.any(Array))
})
