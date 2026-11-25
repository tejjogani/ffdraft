/**
 * The kernel pool sized to the machine: an 8 GB laptop must not be given four workers that can
 * grow to 6 GB between them, and a big workstation still gets the full pool.
 */
import { describe, expect, it } from 'vitest'
import { poolDefaults } from './pool'

describe('kernel pool defaults', () => {
  it('gives an 8 GB, 8-core laptop (a 2023 MacBook Air) two workers of 1 GB, two warm pieces each', () => {
    const d = poolDefaults(8, 8 * 1024)
    expect(d).toEqual({ size: 2, memoryBudgetMb: 1024, kernelsPerWorker: 2 })
    // Within about a third of the machine's memory.
    expect(d.size * d.memoryBudgetMb).toBeLessThanOrEqual(8 * 1024 * 0.3)
  })

  it('gives a 16 GB machine three workers and a 32 GB one the full four', () => {
    expect(poolDefaults(10, 16 * 1024)).toEqual({
      size: 3,
      memoryBudgetMb: 1536,
      kernelsPerWorker: 3,
    })
    expect(poolDefaults(12, 32 * 1024).size).toBe(4)
  })

  it('always leaves a CPU for the server and the browser', () => {
    expect(poolDefaults(2, 32 * 1024).size).toBe(1)
    expect(poolDefaults(4, 64 * 1024).size).toBe(3)
  })

  it('still runs one workable worker on a very small machine', () => {
    expect(poolDefaults(1, 2 * 1024)).toEqual({ size: 1, memoryBudgetMb: 614, kernelsPerWorker: 2 })
    expect(poolDefaults(2, 1024).memoryBudgetMb).toBe(512)
  })
})
