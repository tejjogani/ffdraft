/**
 * Wheel events mean different things on different hardware: a mouse wheel zooms, a trackpad's
 * two-finger swipe should orbit, and a pinch arrives as a wheel event with ctrlKey set (Chrome,
 * Edge and Firefox on every OS; Safari also sends `gesture*` events). The classification is a
 * heuristic, so a setting can force either reading.
 */
export type WheelDevice = 'auto' | 'mouse' | 'trackpad'

export type WheelIntent =
  | { type: 'zoom'; amount: number }
  | { type: 'orbit'; dx: number; dy: number }

const LINE_PX = 16

export function classifyWheel(
  e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey'>,
  device: WheelDevice = 'auto',
): WheelIntent {
  const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? 400 : 1
  const dx = e.deltaX * scale
  const dy = e.deltaY * scale
  // Pinch: ctrl-wheel with fine deltas. A mouse wheel with Ctrl held also zooms.
  if (e.ctrlKey) return { type: 'zoom', amount: dy * 4 }
  if (device === 'mouse') return { type: 'zoom', amount: dy }
  if (device === 'trackpad') return { type: 'orbit', dx, dy }
  // Mice scroll in lines or in large, purely vertical pixel steps; trackpads in small pixel
  // deltas, usually with some horizontal component.
  const mouseLike = e.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 50 && Number.isInteger(dy))
  return mouseLike ? { type: 'zoom', amount: dy } : { type: 'orbit', dx, dy }
}
