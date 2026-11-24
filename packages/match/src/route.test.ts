import { describe, expect, it } from 'vitest'
import { ROUTE_THRESHOLDS, routePart } from './route'

describe('routePart', () => {
  const base = { iou: 0.95, edgeMm: 0.2, sizeMm: 20, flat: false, realViews: 1 }
  it('keeps the recipe when the part is explained, and otherwise takes the lowest freedom', () => {
    expect(routePart(base).route).toBe('parametric')
    expect(routePart({ ...base, edgeMm: 0.7 }).route).toBe('relief')
    expect(routePart({ ...base, iou: 0.8, flat: true }).route).toBe('outline')
    expect(routePart({ ...base, iou: 0.8, realViews: 2, meshOverlap: 0.9 }).route).toBe('mesh')
    expect(routePart({ ...base, iou: 0.8, realViews: 2, meshOverlap: 0.8 }).route).toBe('relief')
    expect(routePart({ ...base, iou: 0.8, realViews: 1, meshOverlap: 0.99 }).route).toBe('relief')
    expect(ROUTE_THRESHOLDS).toMatchObject({
      iou: 0.9,
      edgeFraction: 0.03,
      meshOverlap: 0.85,
      meshViews: 2,
    })
    expect(routePart({ ...base, iou: 0.5 }).reason).toMatch(/0\.50/)
  })
})
