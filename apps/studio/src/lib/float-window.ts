/**
 * Geometry of the studio's floating windows (the assistant, the references): where a window
 * sits, how it moves and resizes, when a drag snaps it into the right-hand sidebar, and how a
 * remembered position is brought back on screen when the window has since become smaller.
 * Pure, so the rules are unit-tested; the components only feed it pointer positions.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Size {
  w: number
  h: number
}

/** The smallest a window may be. */
export interface Limits {
  minW: number
  minH: number
}

/** Pointer this close to the right edge while dragging the title bar docks the window. */
export const SNAP_PX = 32
/** A window keeps this much of itself (at least its title bar) inside the viewport. */
export const KEEP_PX = 96
/** The title bar's height: always reachable, so a window can be moved back. */
export const TITLE_PX = 40
/** Space kept clear of the viewport's edges for a new window. */
export const MARGIN_PX = 16

/** A new window: on the right, below the page header, sized to fit the viewport. */
export function defaultRect(view: Size, want: Size, limits: Limits): Rect {
  const w = Math.max(limits.minW, Math.min(want.w, view.w - 2 * MARGIN_PX))
  const h = Math.max(limits.minH, Math.min(want.h, view.h - 2 * MARGIN_PX - 44))
  return clampRect({ x: view.w - w - MARGIN_PX, y: 44 + MARGIN_PX, w, h }, view, limits)
}

/**
 * The rect made fit: at least the minimum size, no larger than the viewport, and placed so its
 * title bar stays on screen with at least {@link KEEP_PX} of it visible across.
 */
export function clampRect(r: Rect, view: Size, limits: Limits): Rect {
  const w = Math.round(Math.min(Math.max(r.w, limits.minW), Math.max(limits.minW, view.w)))
  const h = Math.round(Math.min(Math.max(r.h, limits.minH), Math.max(limits.minH, view.h)))
  const keep = Math.min(KEEP_PX, w)
  const x = Math.round(Math.min(Math.max(r.x, keep - w), view.w - keep))
  const y = Math.round(Math.min(Math.max(r.y, 0), Math.max(0, view.h - TITLE_PX)))
  return { x, y, w, h }
}

/** The window moved by a drag of its title bar. */
export function moveRect(start: Rect, dx: number, dy: number, view: Size, limits: Limits): Rect {
  return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, view, limits)
}

/** Which edges a resize handle moves: any of n, e, s, w (a corner is two). */
export type Edge = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** The window resized from a handle; the opposite edges stay where they were. */
export function resizeRect(
  start: Rect,
  edge: Edge,
  dx: number,
  dy: number,
  view: Size,
  limits: Limits,
): Rect {
  let { x, y, w, h } = start
  if (edge.includes('e')) w = Math.max(limits.minW, start.w + dx)
  if (edge.includes('s')) h = Math.max(limits.minH, start.h + dy)
  if (edge.includes('w')) {
    w = Math.max(limits.minW, start.w - dx)
    x = start.x + start.w - w
  }
  if (edge.includes('n')) {
    h = Math.max(limits.minH, start.h - dy)
    y = start.y + start.h - h
  }
  // Never past the viewport's edges while resizing (moving can take it partly off).
  if (x < 0) {
    w += x
    x = 0
  }
  if (y < 0) {
    h += y
    y = 0
  }
  w = Math.min(w, view.w - x)
  h = Math.min(h, view.h - y)
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(Math.max(w, limits.minW)),
    h: Math.round(Math.max(h, limits.minH)),
  }
}

/** Whether a title-bar drag ending (or hovering) at this pointer x docks the window. */
export function snapsToSide(pointerX: number, view: Size): boolean {
  return pointerX >= view.w - SNAP_PX
}

/** Arrow keys on a focused title bar move the window (Shift: further), for keyboard users. */
export function nudge(
  r: Rect,
  key: string,
  shift: boolean,
  view: Size,
  limits: Limits,
): Rect | null {
  const step = shift ? 40 : 10
  const d: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  const by = d[key]
  return by ? moveRect(r, by[0], by[1], view, limits) : null
}
