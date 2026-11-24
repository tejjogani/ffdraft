import { describe, expect, it } from 'vitest'
import { createWheelClassifier, type WheelInput } from './wheel'

const wheel = (deltaY: number, more: Partial<WheelInput> = {}): WheelInput => ({
  deltaX: 0,
  deltaY,
  deltaMode: 0,
  ctrlKey: false,
  ...more,
})
/** Each call is its own gesture (two seconds apart). */
const fresh = () => {
  const c = createWheelClassifier()
  let t = 0
  return (e: WheelInput, device?: 'auto' | 'mouse' | 'trackpad') => {
    t += 2000
    return c.classify(e, device, t)
  }
}

describe('wheel classifier', () => {
  it('reads a pinch (ctrl-wheel) as zoom', () => {
    expect(fresh()(wheel(-3.2, { ctrlKey: true }))).toEqual({ type: 'zoom' })
  })

  it('reads a mouse notch as zoom on every platform', () => {
    const c = fresh()
    // macOS Chrome / Safari / Electron: a few fractional pixels.
    expect(c(wheel(4.000244140625, { wheelDeltaY: -120 }))).toEqual({ type: 'zoom' })
    // Windows Chrome at 110 % and 150 % browser zoom.
    expect(c(wheel(90.909, { wheelDeltaY: -120 }))).toEqual({ type: 'zoom' })
    expect(c(wheel(66.667, { wheelDeltaY: -240 }))).toEqual({ type: 'zoom' })
    // Firefox scrolls a mouse in lines and has no wheelDelta.
    expect(c(wheel(3, { deltaMode: 1 }))).toEqual({ type: 'zoom' })
  })

  it('reads a trackpad swipe as an orbit, even with integer deltas', () => {
    const c = fresh()
    expect(c(wheel(64, { wheelDeltaY: -192 }))).toEqual({ type: 'orbit', dx: 0, dy: 64 })
    expect(c(wheel(-7.5, { deltaX: 4, wheelDeltaX: -12, wheelDeltaY: 22 }))).toEqual({
      type: 'orbit',
      dx: 4,
      dy: -7.5,
    })
  })

  it('keeps one reading for the whole of a gesture', () => {
    const c = createWheelClassifier()
    expect(c.classify(wheel(6, { wheelDeltaY: -18 }), 'auto', 0).type).toBe('orbit')
    // A trackpad event that happens to look like a notch, mid-swipe.
    expect(c.classify(wheel(40, { wheelDeltaY: -120 }), 'auto', 16).type).toBe('orbit')
    expect(c.classify(wheel(40, { wheelDeltaY: -120 }), 'auto', 3000).type).toBe('zoom')
  })

  it('obeys a forced device', () => {
    expect(fresh()(wheel(-7.5, { deltaX: 4 }), 'mouse')).toEqual({ type: 'zoom' })
    expect(fresh()(wheel(100, { wheelDeltaY: -120 }), 'trackpad')).toMatchObject({
      type: 'orbit',
    })
  })
})
