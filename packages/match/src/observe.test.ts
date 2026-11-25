import { describe, expect, it } from 'vitest'
import { HIDE_FRACTION, hiddenChange } from './observe'

describe('hiddenChange', () => {
  it('reads a rise above the hiding level as a quadratic well inside the nudge', () => {
    // The nudge rose the loss by 4× what can hide: a quadratic hides half the nudge.
    expect(hiddenChange(0.25, 4 * HIDE_FRACTION * 0.01, 0.01)).toBeCloseTo(0.125, 9)
  })

  it('grows only linearly past the nudge: no evidence the rise keeps accelerating', () => {
    // A top-view head height: a 0.25 mm nudge rose the loss by 0.001 on a 0.00516 residual. The
    // quadratic read said 0.395 mm could hide, but the fit sat 1.65 mm off the truth. A convex
    // loss is only guaranteed to rise linearly beyond the probe, so the bound is 0.25 · 2.58.
    const rise = 0.001032
    const noise = 0.00516
    expect(hiddenChange(0.25, rise, noise)).toBeCloseTo((0.25 * HIDE_FRACTION * noise) / rise, 9)
    expect(hiddenChange(0.25, rise, noise)).toBeGreaterThan(0.5)
  })

  it('is unbounded when the nudge did not raise the loss at all', () => {
    expect(hiddenChange(0.25, 0, 0.01)).toBe(Infinity)
  })
})
