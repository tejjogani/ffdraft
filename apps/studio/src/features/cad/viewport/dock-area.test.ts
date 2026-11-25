/**
 * Where the Replace stone dialog docks on the Design tab. The review found it fixed at the top
 * right with no height: on a laptop-height window its Replace button fell below the window, at
 * 1024 wide it covered the stone being replaced, and it sat over the view's toolbar (Export)
 * and the facts strip. These pin the place it is given instead.
 */
import { describe, expect, it } from 'vitest'
import { HUD_BAND_PX } from '../../../components/stage/viewer'
import { dockArea } from './dock-area'

/** A DOMRect-like box from its edges. */
const rect = (left: number, top: number, right: number, bottom: number) => ({
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
})

/** The box a dock area describes, back in window coordinates. */
const box = (a: ReturnType<typeof dockArea>, windowWidth: number) => ({
  left: windowWidth - a.right - a.width,
  right: windowWidth - a.right,
  top: a.top,
  bottom: a.top + a.height,
})

describe('dockArea', () => {
  it('sits over the inspector column when it is shown, and the view keeps its full width', () => {
    const inspector = rect(1120, 81, 1440, 900)
    const a = dockArea({ inspector, viewport: rect(496, 81, 1120, 900) }, 1440)
    const b = box(a, 1440)
    expect(b.left).toBeGreaterThanOrEqual(1120)
    expect(b.right).toBeLessThanOrEqual(1440)
    expect(b.top).toBeGreaterThanOrEqual(81)
    expect(b.bottom).toBeLessThanOrEqual(900)
    expect(a.viewInset).toBe(0)
  })

  // The 1024 × 768 case of the review: no inspector, the dialog goes over the view.
  it('over the view, stays between the toolbar band and the facts strip', () => {
    const viewport = rect(248, 81, 1024, 768)
    const b = box(dockArea({ inspector: null, viewport }, 1024), 1024)
    expect(b.top).toBeGreaterThanOrEqual(viewport.top + HUD_BAND_PX)
    expect(b.bottom).toBeLessThanOrEqual(viewport.bottom - HUD_BAND_PX)
    expect(b.right).toBeLessThanOrEqual(viewport.right)
  })

  it('over the view, tells the view how much it covers, so the piece is framed beside it', () => {
    const viewport = rect(248, 81, 1024, 768)
    const a = dockArea({ inspector: null, viewport }, 1024)
    const b = box(a, 1024)
    // Everything left of the dialog's left edge is what the view frames the piece in.
    expect(viewport.right - a.viewInset).toBeLessThanOrEqual(b.left)
    expect(a.viewInset).toBeLessThan(viewport.width * 0.6)
  })

  // The 1280 × 680 and 1024 × 640 windows where Replace fell below the window.
  it.each([
    [1280, 680],
    [1024, 640],
    [1024, 520],
  ])('on a %i × %i window ends inside the window, with a fixed height', (w, h) => {
    const viewport = rect(248, 81, w, h)
    const a = dockArea({ inspector: null, viewport }, w)
    const b = box(a, w)
    expect(b.bottom).toBeLessThanOrEqual(h)
    expect(b.top).toBeGreaterThanOrEqual(viewport.top)
    // A fixed height is what keeps the footer from moving while the body fills in.
    expect(a.height).toBeGreaterThan(0)
    expect(a.height).toBe(b.bottom - b.top)
  })

  it('on a short window gives the dialog room before keeping the toolbar band clear', () => {
    const viewport = rect(248, 81, 1024, 520)
    const a = dockArea({ inspector: null, viewport }, 1024)
    expect(a.height).toBeGreaterThan(viewport.height - 2 * HUD_BAND_PX)
  })
})
