import { describe, expect, it } from 'vitest'
import { gemCarat, gemDims, gemDimsFromCarat } from './gems'

describe('round melee weights', () => {
  // Trade per-stone weights for well-cut round melee (the parcel tables melee is bought by).
  const TRADE: [number, number][] = [
    [0.8, 0.0025],
    [1.0, 0.005],
    [1.3, 0.01],
    [1.5, 0.015],
    [1.7, 0.02],
    [2.0, 0.03],
    [2.5, 0.06],
    [3.0, 0.1],
    [6.5, 1.0],
  ]
  it('agree with the trade table within 10 %, so iced pieces are not under-quoted', () => {
    for (const [w, ct] of TRADE)
      expect(Math.abs(gemCarat('round', gemDims('round', w)) / ct - 1), `${w} mm`).toBeLessThan(
        0.1,
      )
  })
  it('round-trip from carat back to the same diameter', () => {
    for (const [w] of TRADE) {
      const carat = gemCarat('round', gemDims('round', w))
      expect(gemDimsFromCarat('round', carat).width).toBeCloseTo(w, 4)
    }
  })
})
