import { describe, expect, it } from 'vitest'
import { mulberry32 } from './rng'

describe('mulberry32', () => {
  it('is uniform on [0, 1) and repeats exactly for a seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const xs = Array.from({ length: 10_000 }, () => a())
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
    expect(Array.from({ length: 10_000 }, () => b())).toEqual(xs)
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.01)
    expect(mulberry32(43)()).not.toBe(xs[0])
  })
})
