import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../rng'
import { count } from '../testkit'
import type { TargetView } from '../types'
import { degrade } from './degrade'

function disc(): TargetView {
  const w = 96
  const matte = new Uint8Array(w * w)
  const stones = new Uint8Array(w * w)
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const r = Math.hypot(x + 0.5 - 48, y + 0.5 - 48)
      if (r < 30) matte[y * w + x] = 1
      if (r < 10) stones[y * w + x] = 1
    }
  const marks = Array.from({ length: 20 }, (_, i) => ({ x: 20 + i * 3, y: 48, d: 4 }))
  return { id: 'v', width: w, height: w, matte, stones, marks }
}

describe('degrade', () => {
  it('leaves a clean view as it is', () => {
    const v = disc()
    expect(degrade(v, 'clean', mulberry32(1))).toEqual(v)
  })

  it('noisy: a pixel or two of outline noise, a blur, a small crop offset, dropped and jittered marks', () => {
    const v = disc()
    const n = degrade(v, 'noisy', mulberry32(3))
    const a = count(v.matte)
    const b = count(n.matte)
    expect(Math.abs(b / a - 1)).toBeLessThan(0.12)
    let diff = 0
    for (let k = 0; k < a; k++) if (v.matte[k] !== n.matte[k]) diff++
    expect(diff).toBeGreaterThan(0)
    expect(n.marks!.length).toBeLessThan(20)
    expect(n.marks!.length).toBeGreaterThanOrEqual(15)
    expect(n.marks!.some((m, i) => m.x !== v.marks![i]!.x)).toBe(true)
    // Deterministic for a seed.
    expect(degrade(disc(), 'noisy', mulberry32(3))).toEqual(n)
  })

  it('hard: erodes 2 px and punches holes of at most 2 % of the area', () => {
    const v = disc()
    const h = degrade(v, 'hard', mulberry32(5))
    const lost = 1 - count(h.matte) / count(v.matte)
    expect(lost).toBeGreaterThan(0.08) // a 2 px erosion of a radius-30 disc alone removes about 13 %
    expect(lost).toBeLessThan(0.3)
  })
})
