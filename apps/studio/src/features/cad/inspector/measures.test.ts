import { ringInnerDiameter } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import {
  caratOf,
  inSystem,
  type StoneSpec,
  sizeOptions,
  snapWidth,
  widthForCarat,
} from './measures'

const round: StoneSpec = { cut: 'round', stone: 'diamond' }
/** A number that is exactly a multiple of 0.01 as JSON stores it: no `3.2600000000000002`. */
const hundredths = (v: number) => Number(v.toFixed(2)) === v

describe('stone size in carats', () => {
  it('knows the classic one-carat round is about 6.5 mm', () => {
    expect(caratOf(round, 6.5)).toBeGreaterThan(0.95)
    expect(caratOf(round, 6.5)).toBeLessThan(1.05)
    expect(widthForCarat(round, 1, 0.5, 40)).toBeGreaterThan(6.3)
    expect(widthForCarat(round, 1, 0.5, 40)).toBeLessThan(6.6)
  })

  it('gives the width back for the carat a width implies', () => {
    for (const w of [1.3, 3, 5.2, 6.5, 9.35])
      expect(widthForCarat(round, caratOf(round, w), 0.5, 40)).toBeCloseTo(w, 2)
  })

  it('writes widths that are exact hundredths of a millimetre', () => {
    // The width is stored in the design: 0.13 ct must write 3.26, not 3.2600000000000002.
    const noisy: number[] = []
    for (let i = 5; i <= 500; i++) {
      const w = widthForCarat(round, i / 100, 0.5, 40)
      if (!hundredths(w)) noisy.push(w)
    }
    expect(noisy).toEqual([])
  })

  it('keeps the width inside the field’s range', () => {
    expect(widthForCarat(round, 0.0001, 0.8, 40)).toBe(0.8)
    expect(widthForCarat(round, 900, 0.5, 12)).toBe(12)
  })

  it('snaps melee to a stock size and leaves other stones alone', () => {
    expect(snapWidth(6.47, undefined)).toBe(6.47)
    expect(snapWidth(1.27, 'melee')).not.toBe(1.27)
    expect(Math.abs(snapWidth(1.27, 'melee') - 1.27)).toBeLessThan(0.1)
  })
})

describe('ring sizes', () => {
  it('offers every size of a system once, smallest first, on the system’s own steps', () => {
    const us = sizeOptions('us').map((s) => s.value)
    expect(us[0]).toBe(2)
    expect(us.at(-1)).toBe(16)
    expect(us).toContain(6.25)
    expect(us).toHaveLength((16 - 2) / 0.25 + 1)
    expect(new Set(us).size).toBe(us.length)
    expect(us).toEqual(us.toSorted((a, b) => a - b))
    expect(sizeOptions('eu').map((s) => s.value)).toContain(52.5)
    expect(sizeOptions('jp').every((s) => Number.isInteger(s.value))).toBe(true)
    for (const system of ['us', 'uk', 'eu', 'jp'] as const)
      expect(sizeOptions(system).every((s) => s.system === system)).toBe(true)
  })

  it('reads a size in its own system exactly, and in another as the nearest size with its error', () => {
    const us6 = { system: 'us', value: 6 } as const
    expect(inSystem(us6, 'us')).toEqual({ size: us6, approx: false, deltaMm: 0 })
    const eu = inSystem(us6, 'eu')
    expect(eu.approx).toBe(true)
    expect(eu.size.system).toBe('eu')
    expect(eu.deltaMm).toBeCloseTo(ringInnerDiameter(eu.size) - ringInnerDiameter(us6), 10)
    // Half an EU size is 0.16 mm of diameter: the nearest size is never further than that.
    expect(Math.abs(eu.deltaMm)).toBeLessThan(0.17)
    expect(inSystem(us6, 'mm').size.value).toBeCloseTo(ringInnerDiameter(us6), 2)
  })
})
