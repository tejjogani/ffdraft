import type { ImagePlane } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import {
  fromView,
  initialPlane,
  moveBy,
  onPlane,
  planeDepth,
  scaleByTwoPoints,
  toView,
  VIEW_AXES,
} from './image-planes'
import { changeLabel, EMPTY_HISTORY, forget, record, redoStep, undoStep } from './plane-history'

const ring = {
  min: [-10, -2, -10] as [number, number, number],
  max: [10, 2, 12] as [number, number, number],
}
const plane: ImagePlane = { view: 'front', center: [0, 1], width: 40, opacity: 0.6, locked: false }

describe('the views’ axes', () => {
  it('are right-handed and face their camera', () => {
    for (const { right, up, normal } of Object.values(VIEW_AXES)) {
      const cross = [
        right[1] * up[2] - right[2] * up[1],
        right[2] * up[0] - right[0] * up[2],
        right[0] * up[1] - right[1] * up[0],
      ]
      expect(cross).toEqual(normal.map((n) => n + 0))
    }
  })

  it('go to a view and back at the plane’s depth', () => {
    for (const view of ['front', 'top', 'right'] as const) {
      const d = planeDepth(view, ring)
      const p = fromView(view, [3, -4], d)
      expect(toView(view, p)).toEqual([3, -4])
    }
    // A front picture lies through the ring's middle along Y.
    expect(planeDepth('front', ring)).toBe(0)
    expect(planeDepth('top', ring)).toBe(1)
    expect(fromView('right', [2, 5], 0)).toEqual([0, 2, 5])
  })
})

describe('placing, moving and scaling a picture', () => {
  it('first lays it over the piece with room around it', () => {
    const p = initialPlane('front', ring, 0.75)
    expect(p.center).toEqual([0, 1])
    // 1.6× the ring's 22 mm height, at a 3:4 picture: the height decides.
    expect(p.width).toBeCloseTo((22 * 1.6) / 0.75, 3)
    expect(p).toMatchObject({ view: 'front', opacity: 0.6, locked: false })
    expect(initialPlane('top', null, 1).center).toEqual([0, 0])
  })

  it('moves by a drag', () => {
    expect(moveBy(plane, 2.5, -1).center).toEqual([2.5, 0])
  })

  it('scales so two clicked points are the typed distance apart, about the first point', () => {
    // Two points 10 mm apart on the picture are really a 6.5 mm stone.
    const a: [number, number] = [-5, 1]
    const b: [number, number] = [5, 1]
    const next = scaleByTwoPoints(plane, a, b, 6.5)!
    expect(next.width).toBeCloseTo(26, 3)
    // The first point stays put: it was 5 mm left of the centre, now 3.25.
    expect(next.center).toEqual([-5 + 5 * 0.65, 1])
    // Measured again at the new size, the points are 6.5 mm apart.
    const k = next.width / plane.width
    const b2: [number, number] = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
    expect(Math.hypot(b2[0] - a[0], b2[1] - a[1])).toBeCloseTo(6.5, 6)
    expect(scaleByTwoPoints(plane, a, a, 6.5)).toBeNull()
    expect(scaleByTwoPoints(plane, a, b, 0)).toBeNull()
  })

  it('knows whether a point is on the picture', () => {
    expect(onPlane(plane, 0.5, [19, 10])).toBe(true)
    expect(onPlane(plane, 0.5, [21, 0])).toBe(false)
    expect(onPlane(plane, 0.5, [0, 12])).toBe(false)
  })
})

describe('undoing picture changes', () => {
  it('adds, moves and removes, then undoes each and redoes', () => {
    const moved = moveBy(plane, 4, 0)
    let h = EMPTY_HISTORY
    h = record(h, { refId: 'r1', before: null, after: plane, label: changeLabel(null, plane) })
    h = record(h, { refId: 'r1', before: plane, after: moved, label: changeLabel(plane, moved) })
    h = record(h, { refId: 'r1', before: moved, after: null, label: changeLabel(moved, null) })
    expect(h.undo.map((c) => c.label)).toEqual([
      'Placed the picture in the front view',
      'Moved the picture',
      'Took the picture out of the view',
    ])

    const u1 = undoStep(h)!
    expect(u1.plane).toEqual(moved) // removing is undone: it comes back where it was
    const u2 = undoStep(u1.history)!
    expect(u2.plane).toEqual(plane) // the move is undone
    const u3 = undoStep(u2.history)!
    expect(u3.plane).toBeNull() // adding is undone: out of the view
    expect(undoStep(u3.history)).toBeNull()

    const r1 = redoStep(u3.history)!
    expect(r1.plane).toEqual(plane)
    // A new change after undoing drops what could be redone.
    const branched = record(r1.history, {
      refId: 'r1',
      before: plane,
      after: { ...plane, locked: true },
      label: 'Locked the picture',
    })
    expect(branched.redo).toEqual([])
    // A change that changes nothing is not recorded; an unpinned picture's changes are dropped.
    expect(record(branched, { refId: 'r1', before: plane, after: { ...plane }, label: 'x' })).toBe(
      branched,
    )
    expect(forget(branched, 'r1')).toEqual(EMPTY_HISTORY)
  })

  it('names what changed', () => {
    expect(changeLabel(plane, { ...plane, width: 30 })).toBe('Scaled the picture')
    expect(changeLabel(plane, { ...plane, opacity: 0.3 })).toBe('Faded the picture')
    expect(changeLabel(plane, { ...plane, view: 'top' })).toBe('Moved the picture to the top view')
    expect(changeLabel(plane, { ...plane, locked: true })).toBe('Locked the picture')
  })
})
