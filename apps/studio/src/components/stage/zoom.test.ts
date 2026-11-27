import { describe, expect, it } from 'vitest'
import { pinchWheelFactor, zoomSliderDistance, zoomSliderValue } from './zoom'

describe('viewport zoom slider', () => {
  it('gives equal travel to equal ratios of camera distance', () => {
    expect(zoomSliderDistance(0, 2, 200)).toBe(200)
    expect(zoomSliderDistance(50, 2, 200)).toBeCloseTo(20)
    expect(zoomSliderDistance(100, 2, 200)).toBe(2)
    expect(zoomSliderValue(20, 2, 200)).toBe(50)
  })

  it('keeps views outside the slider range on its endpoints', () => {
    expect(zoomSliderValue(1, 2, 200)).toBe(100)
    expect(zoomSliderValue(500, 2, 200)).toBe(0)
  })
})

describe('trackpad pinch zoom', () => {
  it('magnifies a fine pinch delta and reverses the same movement', () => {
    const closer = pinchWheelFactor(-10)
    expect(closer).toBeGreaterThan(1.2)
    expect(closer * pinchWheelFactor(10)).toBeCloseTo(1)
    expect(pinchWheelFactor(0)).toBe(1)
  })

  it('bounds the scale of a single unusually large event', () => {
    expect(pinchWheelFactor(-10000)).toBeLessThan(8)
    expect(pinchWheelFactor(10000)).toBeGreaterThan(0.12)
  })
})
