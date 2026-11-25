import { describe, expect, it } from 'vitest'
import { MELEE_SIZES_MM, snapToMelee } from './gems'
import { formatRingSize, ringInnerDiameter, ringSizeFromDiameter } from './sizes'

describe('ring sizes and stock sizes', () => {
  it('prints UK sizes past Z as Z+n and never below A', () => {
    expect(formatRingSize(ringSizeFromDiameter(22.33, 'uk'))).toMatch(/^UK Z\+\d/)
    expect(formatRingSize({ system: 'uk', value: 25.5 })).toBe('UK Z½')
    expect(formatRingSize({ system: 'uk', value: -3 })).toBe('UK A')
  })

  it('stores millimetre sizes without float noise', () => {
    for (let d = 14; d < 24; d += 0.01) {
      const v = ringSizeFromDiameter(d, 'mm').value
      expect(String(v).length).toBeLessThanOrEqual(5)
    }
  })

  it('stocks melee between 3.0 and 3.25 mm', () => {
    expect(snapToMelee(3.1)).toBe(3.1)
    expect(MELEE_SIZES_MM).toEqual([...MELEE_SIZES_MM].sort((a, b) => a - b))
  })
})

describe('ring size tables', () => {
  // Inner diameters in mm as ring-size charts print them (two decimals; charts differ in the
  // last digit, hence 0.01 mm).
  const US: [number, number][] = [
    [3, 14.07],
    [4, 14.88],
    [5, 15.7],
    [6, 16.51],
    [7, 17.32],
    [8, 18.14],
    [9, 18.95],
    [10, 19.76],
    [11, 20.57],
    [12, 21.39],
    [13, 22.2],
  ]
  it('US sizes match the published diameters, and the UK and EU sizes beside them', () => {
    for (const [size, mm] of US)
      expect(
        Math.abs(ringInnerDiameter({ system: 'us', value: size }) - mm),
        `US ${size}`,
      ).toBeLessThan(0.011)
    // The same fingers on a UK and an EU stick: US 6 = L½ = 52, US 7 = N½ = 54.5, US 9 = R½ = 59.5.
    expect(formatRingSize(ringSizeFromDiameter(16.51, 'uk'))).toBe('UK L½')
    expect(formatRingSize(ringSizeFromDiameter(17.32, 'uk'))).toBe('UK N½')
    expect(formatRingSize(ringSizeFromDiameter(18.95, 'uk'))).toBe('UK R½')
    expect(ringSizeFromDiameter(16.51, 'eu').value).toBe(52)
    expect(ringSizeFromDiameter(17.32, 'eu').value).toBe(54.5)
    expect(ringSizeFromDiameter(18.95, 'eu').value).toBe(59.5)
    // EU is the inner circumference: 54 mm round a 17.19 mm finger.
    expect(ringInnerDiameter({ system: 'eu', value: 54 })).toBeCloseTo(54 / Math.PI, 10)
  })

  it('every size a system offers converts to a diameter and back to itself', () => {
    const ranges = {
      us: [0, 16, 0.25],
      uk: [0, 30, 0.5],
      eu: [38, 76, 0.5],
      jp: [1, 30, 1],
      mm: [12, 25, 0.01],
    } as const
    for (const [system, [from, to, step]] of Object.entries(ranges) as [
      keyof typeof ranges,
      readonly [number, number, number],
    ][])
      for (let i = 0; from + i * step <= to + 1e-9; i++) {
        const value = Number((from + i * step).toFixed(2))
        const back = ringSizeFromDiameter(ringInnerDiameter({ system, value }), system).value
        expect(back, `${system} ${value}`).toBeCloseTo(value, 9)
      }
  })
})
