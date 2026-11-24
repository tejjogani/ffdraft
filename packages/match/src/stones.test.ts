import { describe, expect, it } from 'vitest'
import { expectedCount, matchStones, paveStats, projectStones, rowCount } from './stones'
import { fakeEvaluation } from './testkit'
import type { Camera, StoneMark } from './types'

const cam: Camera = {
  azimuth: 0,
  elevation: 0,
  roll: 0,
  distance: 200,
  span: 20,
  shift: [0, 0],
  target: [0, 0, 0],
}

describe('stones', () => {
  it('projects each stone to a centre and a diameter in pixels', () => {
    const e = fakeEvaluation(
      [],
      [
        { nodeId: 'a', at: [0, 0, 0], width: 2 },
        { nodeId: 'b', at: [5, 0, 0], width: 1 },
      ],
    )
    const m = projectStones(e, cam, { width: 100, height: 100 })
    expect(m[0]).toMatchObject({ id: 'a:0', x: 50, y: 50, d: 10 })
    expect(m[1]!.x).toBeCloseTo(75)
    expect(projectStones(e, cam, { width: 100, height: 100 }, { nodeIds: ['b'] })).toHaveLength(1)
  })

  it('pairs marks nearest first, and lists the missing and the extra', () => {
    const a: StoneMark[] = [
      { x: 0, y: 0, d: 2 },
      { x: 10, y: 0, d: 2 },
      { x: 50, y: 50, d: 2 },
    ]
    const b: StoneMark[] = [
      { x: 9, y: 0, d: 2 },
      { x: 1, y: 1, d: 2 },
      { x: 90, y: 90, d: 2 },
    ]
    const r = matchStones(a, b, 3)
    expect(r.pairs).toEqual([
      [1, 0],
      [0, 1],
    ])
    expect(r.missing).toEqual([2])
    expect(r.extra).toEqual([2])
    expect(r.meanPx).toBeCloseTo((1 + Math.SQRT2) / 2)
  })

  it('reads a pavé field into sizes, gap and coverage', () => {
    // A hexagonal field of 1.3 mm stones at a 1.5 mm pitch, 10 px per mm.
    const marks: StoneMark[] = []
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 10; c++)
        marks.push({ x: (c + (r % 2) / 2) * 15, y: r * 15 * (Math.sqrt(3) / 2), d: 13 })
    const area = 10 * 15 * (10 * 15 * (Math.sqrt(3) / 2))
    const s = paveStats(marks, 0.1, area)
    expect(s.sizeMin).toBe(1.3)
    expect(s.sizeMax).toBe(1.3)
    expect(s.gap).toBeCloseTo(0.2)
    expect(s.coverage).toBeGreaterThan(0.95)
    expect(s.coverage).toBeLessThanOrEqual(1)
    expect(expectedCount({ areaMm2: area / 100, ...s })).toBeGreaterThan(95)
    expect(expectedCount({ areaMm2: area / 100, ...s })).toBeLessThan(105)
  })

  it('counts stones along an arc', () => {
    expect(rowCount(30, 2, 0.2)).toBe(13)
    expect(rowCount(1, 2, 0.2)).toBe(0)
  })
})
