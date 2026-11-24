import { describe, expect, it } from 'vitest'
import { classifyWheel } from './wheel'

const wheel = (deltaX: number, deltaY: number, deltaMode = 0, ctrlKey = false) => ({
  deltaX,
  deltaY,
  deltaMode,
  ctrlKey,
})

describe('wheel classifier', () => {
  it('reads a pinch (ctrl-wheel) as zoom', () => {
    expect(classifyWheel(wheel(0, -3.2, 0, true))).toMatchObject({ type: 'zoom' })
  })
  it('reads line-mode and large integer vertical steps as a mouse wheel', () => {
    expect(classifyWheel(wheel(0, 3, 1))).toEqual({ type: 'zoom', amount: 48 })
    expect(classifyWheel(wheel(0, 100))).toEqual({ type: 'zoom', amount: 100 })
  })
  it('reads small pixel deltas as a trackpad swipe that orbits', () => {
    expect(classifyWheel(wheel(4, -7.5))).toEqual({ type: 'orbit', dx: 4, dy: -7.5 })
  })
  it('obeys a forced device', () => {
    expect(classifyWheel(wheel(4, -7.5), 'mouse')).toMatchObject({ type: 'zoom' })
    expect(classifyWheel(wheel(0, 100), 'trackpad')).toMatchObject({ type: 'orbit' })
  })
})
