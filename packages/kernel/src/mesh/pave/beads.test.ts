/**
 * Beads around stones laid in a single row: whichever way the row runs, every stone is held
 * from both sides of the row (the edge-bead search must not stop at the neighbour's spot).
 */
import { describe, expect, it } from 'vitest'
import { dot, normalize, sub, type Vec3 } from '../../geometry/vec'
import { layoutBeads } from './beads'
import type { PlacedStone } from './layout'

/** Stones 1.8 mm across, 0.2 mm apart, in a row along `dir` on the plane y = 0 (facing −Y). */
function row(dir: Vec3, count = 8): PlacedStone[] {
  const d = normalize(dir)
  return Array.from({ length: count }, (_, i) => ({
    position: [d[0] * 2 * i, 0, d[2] * 2 * i] as Vec3,
    normal: [0, -1, 0] as Vec3,
    diameter: 1.8,
    hole: 0,
  }))
}

const onPlane = (q: Vec3) => ({ sample: 0, p: [q[0], 0, q[2]] as Vec3, n: [0, -1, 0] as Vec3 })

describe('pavé beads on a single row', () => {
  for (const [name, dir] of [
    ['along X', [1, 0, 0]],
    ['along Z', [0, 0, 1]],
    ['at 45°', [1, 0, 1]],
  ] as const)
    it(`holds every stone from both sides when the row runs ${name}`, () => {
      const stones = row(dir as unknown as Vec3)
      const beads = layoutBeads(stones, 0.2, onPlane)
      const across = normalize([-(dir[2] as number), 0, dir[0] as number])
      for (const s of stones) {
        // Beads that reach this stone's girdle (within a bead of it).
        const grip = beads.filter((b) => {
          const r = Math.hypot(...(sub(b.position, s.position) as [number, number, number]))
          return r < s.diameter / 2 + b.diameter
        })
        const sides = grip.map((b) => Math.sign(dot(sub(b.position, s.position), across)))
        expect(
          sides.filter((x) => x > 0).length,
          `${name}: beads on one side`,
        ).toBeGreaterThanOrEqual(1)
        expect(
          sides.filter((x) => x < 0).length,
          `${name}: beads on the other`,
        ).toBeGreaterThanOrEqual(1)
      }
    })
})
