import { describe, expect, it } from 'vitest'
import { ALLOWANCES, PLANS } from './plans/config'
import {
  allowanceLine,
  ceilingOf,
  exportCounts,
  periodEnd,
  periodOf,
  planLimitAllowanceOf,
  planLimitMessage,
} from './plans/plans'

describe('what a plan counts', () => {
  it('counts Rhino and STEP exports only; STL and the other mesh formats are always free', () => {
    expect(['step', '3dm'].map(exportCounts)).toEqual([true, true])
    expect(['stl', '3mf', 'obj', 'glb'].map(exportCounts)).toEqual([false, false, false, false])
  })

  it('counts per calendar month in UTC, across the year end', () => {
    expect(periodOf(new Date('2026-11-30T23:59:59Z'))).toBe('2026-11')
    expect(periodOf(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12')
    expect(periodEnd(new Date('2026-12-31T23:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    )
  })

  it('caps an unlimited plan at its fair-use ceiling', () => {
    expect(ceilingOf('free', 'render')).toBe(PLANS.free.limits.render)
    expect(PLANS.pro.limits.render).toBeNull()
    expect(ceilingOf('pro', 'render')).toBeGreaterThan(100)
  })

  it('reads the allowance back from every limit sentence, and from nothing else', () => {
    for (const allowance of ALLOWANCES)
      for (const [limit, fairUse] of [
        [5, false],
        [1, false],
        [1000, true],
      ] as const) {
        const text = planLimitMessage({
          plan: fairUse ? 'pro' : 'free',
          allowance,
          limit,
          used: limit,
          resetsAt: '2026-12-01T00:00:00.000Z',
          fairUse,
        })
        expect(planLimitAllowanceOf(text)).toBe(allowance)
      }
    expect(planLimitAllowanceOf('The render failed: Blender crashed.')).toBeNull()
  })

  it('tells the assistant what is left in one line', () => {
    const line = allowanceLine({
      plan: 'free',
      label: 'Free',
      source: 'default',
      localInstall: true,
      period: '2026-11',
      resetsAt: '2026-12-01T00:00:00.000Z',
      allowances: [
        { allowance: 'render', label: 'Blender renders', used: 3, limit: 5, ceiling: 5, left: 2 },
        {
          allowance: 'export',
          label: 'Rhino and STEP exports',
          used: 0,
          limit: 5,
          ceiling: 5,
          left: 5,
        },
      ],
    })
    expect(line).toBe(
      'Free plan: Blender renders 2 of 5 left this month; Rhino and STEP exports 5 of 5 left this month (resets 2026-12-01). Browser previews, captures and STL, 3MF, OBJ and GLB exports are never counted.',
    )
  })
})
