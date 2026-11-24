import { describe, expect, it } from 'vitest'
import { MELEE_SIZES_MM, snapToMelee } from './gems'
import { formatRingSize, ringSizeFromDiameter } from './sizes'

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
