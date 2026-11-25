import { describe, expect, it } from 'vitest'
import { CLICK_SLOP_PX, isClick, isSecondary } from './gesture'

describe('a click, not a drag', () => {
  it('accepts a press released where it started or within the slop', () => {
    expect(isClick({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true)
    expect(isClick({ x: 100, y: 100 }, { x: 103, y: 102 })).toBe(true)
    expect(isClick({ x: 0, y: 0 }, { x: CLICK_SLOP_PX, y: 0 })).toBe(true)
  })

  it('rejects a right-drag pan, even a short one', () => {
    expect(isClick({ x: 100, y: 100 }, { x: 105, y: 100 })).toBe(false)
    expect(isClick({ x: 100, y: 100 }, { x: 160, y: 140 })).toBe(false)
  })
})

describe('the press that opens a context menu', () => {
  it('is the right button everywhere', () => {
    expect(isSecondary({ button: 2, ctrlKey: false }, false)).toBe(true)
    expect(isSecondary({ button: 2, ctrlKey: false }, true)).toBe(true)
  })

  it('is Control-click on macOS only; elsewhere Control-click adds to the selection', () => {
    expect(isSecondary({ button: 0, ctrlKey: true }, true)).toBe(true)
    expect(isSecondary({ button: 0, ctrlKey: true }, false)).toBe(false)
    expect(isSecondary({ button: 0, ctrlKey: false }, true)).toBe(false)
    expect(isSecondary({ button: 1, ctrlKey: false }, true)).toBe(false)
  })
})
