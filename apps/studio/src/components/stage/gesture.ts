/**
 * Telling a click from a drag on the 3D view. The left button orbits and the right button pans,
 * so a pick or a context menu must only follow a press that did not move: a pan that ends over a
 * stone must not open its menu.
 */

/** How far (CSS px) a pointer may travel between press and release and still be a click. */
export const CLICK_SLOP_PX = 4
/** A touch held this long without moving opens the context menu. */
export const LONG_PRESS_MS = 500
/** A finger wanders more than a mouse: a long press may move this far (CSS px). */
export const LONG_PRESS_SLOP_PX = 10

export interface Point {
  x: number
  y: number
}

export const isClick = (down: Point, up: Point, slop = CLICK_SLOP_PX): boolean =>
  Math.hypot(up.x - down.x, up.y - down.y) <= slop

/** The press that asks for a context menu: the right button, or Control-click on macOS. */
export const isSecondary = (e: { button: number; ctrlKey: boolean }, mac: boolean): boolean =>
  e.button === 2 || (mac && e.button === 0 && e.ctrlKey)
