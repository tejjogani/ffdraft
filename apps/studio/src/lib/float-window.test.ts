import { describe, expect, it } from 'vitest'
import {
  clampRect,
  defaultRect,
  KEEP_PX,
  moveRect,
  nudge,
  resizeRect,
  SNAP_PX,
  snapsToSide,
  TITLE_PX,
} from './float-window'

const view = { w: 1440, h: 900 }
const limits = { minW: 320, minH: 360 }

describe('floating windows', () => {
  it('open on the right below the header, sized to fit even a phone-sized screen', () => {
    expect(defaultRect(view, { w: 400, h: 620 }, limits)).toEqual({
      x: 1024,
      y: 60,
      w: 400,
      h: 620,
    })
    const small = defaultRect({ w: 700, h: 500 }, { w: 400, h: 620 }, limits)
    expect(small.h).toBe(424)
    expect(small.x + small.w).toBeLessThanOrEqual(700)
  })

  it('move with the title bar but always keep it reachable', () => {
    const r = { x: 100, y: 100, w: 400, h: 600 }
    expect(moveRect(r, 50, -20, view, limits)).toEqual({ x: 150, y: 80, w: 400, h: 600 })
    // Off the left: KEEP_PX stays on screen; never above the top; the title bar above the bottom.
    expect(moveRect(r, -5000, -5000, view, limits)).toEqual({
      x: KEEP_PX - 400,
      y: 0,
      w: 400,
      h: 600,
    })
    const low = moveRect(r, 5000, 5000, view, limits)
    expect(low.x).toBe(view.w - KEEP_PX)
    expect(low.y).toBe(view.h - TITLE_PX)
  })

  it('resize from any edge or corner, the opposite edges staying put, never below the minimum', () => {
    const r = { x: 400, y: 100, w: 400, h: 600 }
    expect(resizeRect(r, 'se', 100, 50, view, limits)).toEqual({ x: 400, y: 100, w: 500, h: 650 })
    expect(resizeRect(r, 'w', -100, 0, view, limits)).toEqual({ x: 300, y: 100, w: 500, h: 600 })
    expect(resizeRect(r, 'nw', 300, 400, view, limits)).toEqual({
      x: 480,
      y: 340,
      w: 320,
      h: 360,
    })
    // Not past the viewport while resizing.
    expect(resizeRect(r, 'e', 5000, 0, view, limits).w).toBe(view.w - 400)
    expect(resizeRect(r, 'n', 0, -5000, view, limits)).toMatchObject({ y: 0, h: 700 })
  })

  it('a remembered place comes back on screen when the browser is now smaller', () => {
    const remembered = { x: 1800, y: 1000, w: 600, h: 900 }
    const r = clampRect(remembered, { w: 1024, h: 700 }, limits)
    expect(r.h).toBeLessThanOrEqual(700)
    expect(r.x).toBeLessThanOrEqual(1024 - KEEP_PX)
    expect(r.y).toBeLessThanOrEqual(700 - TITLE_PX)
  })

  it('snaps into the sidebar when the title bar is dragged to the right edge', () => {
    expect(snapsToSide(view.w - SNAP_PX, view)).toBe(true)
    expect(snapsToSide(view.w - 1, view)).toBe(true)
    expect(snapsToSide(view.w - SNAP_PX - 1, view)).toBe(false)
  })

  it('moves by arrow keys on the title bar, further with Shift', () => {
    const r = { x: 100, y: 100, w: 400, h: 600 }
    expect(nudge(r, 'ArrowRight', false, view, limits)).toMatchObject({ x: 110 })
    expect(nudge(r, 'ArrowUp', true, view, limits)).toMatchObject({ y: 60 })
    expect(nudge(r, 'Enter', false, view, limits)).toBeNull()
  })
})
