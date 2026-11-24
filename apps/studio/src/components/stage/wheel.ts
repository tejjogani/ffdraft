/**
 * Wheel events mean different things on different hardware: a mouse wheel zooms, a trackpad's
 * two-finger swipe should orbit, and a pinch arrives as a wheel event with ctrlKey set (Chrome,
 * Edge and Firefox on every OS; Safari also sends `gesture*` events). Telling a mouse from a
 * trackpad is a heuristic, so a setting can force either reading.
 */
export type WheelDevice = 'auto' | 'mouse' | 'trackpad'

/** Zoom is left to the camera controls (they zoom to the cursor); an orbit is done by the caller. */
export type WheelIntent = { type: 'zoom' } | { type: 'orbit'; dx: number; dy: number }

export type WheelInput = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey'> & {
  /** Chromium and WebKit's legacy delta: ±120 per notch of a mouse wheel, whatever the zoom. */
  wheelDeltaX?: number
  wheelDeltaY?: number
}

const LINE_PX = 16
const NOTCH = 120
/** A gesture's events arrive closer together than this; its reading must not flip midway. */
const GESTURE_GAP_MS = 1000

/**
 * Whether one event looks like a mouse wheel. Pixel deltas cannot tell: macOS scales a notch
 * to a few fractional pixels and Windows divides it by the browser zoom (90.9 px at 110 %).
 * The legacy `wheelDelta` stays a multiple of 120 per notch, while a trackpad's is small and
 * irregular; Firefox has no `wheelDelta` but scrolls a mouse in lines.
 */
function looksLikeMouse(e: WheelInput): boolean {
  if (e.deltaMode !== 0) return true
  if (e.wheelDeltaY !== undefined)
    return e.wheelDeltaY !== 0 && e.wheelDeltaY % NOTCH === 0 && !e.wheelDeltaX
  return e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY)
}

export interface WheelClassifier {
  classify(e: WheelInput, device?: WheelDevice, now?: number): WheelIntent
}

/** A classifier that remembers its reading for the rest of a gesture. */
export function createWheelClassifier(): WheelClassifier {
  let last = { at: Number.NEGATIVE_INFINITY, mouse: false }
  return {
    classify(e, device = 'auto', now = performance.now()) {
      // Pinch: ctrl-wheel with fine deltas. A mouse wheel with Ctrl held also zooms.
      if (e.ctrlKey || device === 'mouse') return { type: 'zoom' }
      const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? 400 : 1
      const orbit: WheelIntent = { type: 'orbit', dx: e.deltaX * scale, dy: e.deltaY * scale }
      if (device === 'trackpad') return orbit
      const mouse = now - last.at < GESTURE_GAP_MS ? last.mouse : looksLikeMouse(e)
      last = { at: now, mouse }
      return mouse ? { type: 'zoom' } : orbit
    },
  }
}
