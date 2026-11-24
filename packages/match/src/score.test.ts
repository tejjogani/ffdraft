import { describe, expect, it } from 'vitest'
import { rasterize } from './raster'
import { combineLoss, LOSS_WEIGHTS, prepareTarget, scoreView } from './score'
import { boxMesh, fakeEvaluation } from './testkit'
import type { Camera, LabelRaster, TargetView } from './types'

const cam = (o: Partial<Camera> = {}): Camera => ({
  azimuth: 0,
  elevation: 0,
  roll: 0,
  distance: 200,
  span: 20,
  shift: [0, 0],
  target: [0, 0, 0],
  ...o,
})
const size = { width: 128, height: 128 }
const piece = fakeEvaluation(
  [{ nodeId: 'plate', mesh: boxMesh([-6, 0, -4], [6, 1, 4]) }],
  [{ nodeId: 'gem', at: [0, -2, 0], width: 4 }],
)

function viewOf(r: LabelRaster, o: Partial<TargetView> = {}): TargetView {
  return {
    id: 'v',
    width: r.width,
    height: r.height,
    matte: r.cls.map((v) => (v ? 1 : 0)),
    stones: r.cls.map((v) => (v === 2 ? 1 : 0)),
    ...o,
  }
}

describe('scoreView', () => {
  it('scores a perfect match as zero loss', () => {
    const r = rasterize(piece, cam(), size)
    const s = scoreView(r, prepareTarget(viewOf(r)), cam())
    expect(s.iou).toBe(1)
    expect(s.stoneIou).toBe(1)
    expect(s.edgePx).toBe(0)
    expect(s.loss).toBe(0)
  })

  it('measures an outline offset in pixels and in millimetres', () => {
    const t = prepareTarget(viewOf(rasterize(piece, cam(), size), { stones: undefined }))
    const moved = cam({ shift: [3 / 128, 0] }) // three pixels to the right
    const s = scoreView(rasterize(piece, moved, size), t, moved)
    expect(s.stoneIou).toBeNull()
    // Vertical edges move by 3 px, horizontal ones not at all: the mean lies between.
    expect(s.edgePx).toBeGreaterThan(0.8)
    expect(s.edgePx).toBeLessThan(3)
    expect(s.edgeMm).toBeCloseTo((s.edgePx * 20) / 128)
    const E = Math.min(1, (20 * s.edgePx) / 128)
    expect(s.loss).toBeCloseTo(0.6 * (1 - s.iou) + 0.4 * E)
  })

  it('weights the stone terms when the target has a stone mask', () => {
    const t = prepareTarget(viewOf(rasterize(piece, cam(), size)))
    const r = rasterize(piece, cam(), size, { hide: ['gem'] })
    const s = scoreView(r, t, cam())
    expect(s.iou).toBe(1) // the stone sits inside the plate's outline
    expect(s.stoneIou).toBe(0)
    const W = LOSS_WEIGHTS.stones
    const expected =
      W.iou * (1 - s.iou) +
      W.stoneIou * (1 - 0) +
      W.edge * Math.min(1, (20 * s.edgePx) / 128) +
      W.stoneEdge * Math.min(1, (20 * s.stoneEdgePx!) / 128)
    expect(s.loss).toBeCloseTo(expected)
    expect(s.stoneEdgePx).toBeGreaterThan(0)
  })

  it('scores named parts by the nodes that should cover them', () => {
    const full = rasterize(piece, cam(), size)
    const gemMask = full.cls.map((v) => (v === 2 ? 1 : 0))
    const t = prepareTarget(
      viewOf(full, { parts: [{ key: 'centre', mask: gemMask, nodeIds: ['gem'] }] }),
    )
    expect(scoreView(full, t, cam()).parts).toEqual([{ key: 'centre', iou: 1, edgePx: 0 }])
    const s = scoreView(rasterize(piece, cam(), size, { hide: ['gem'] }), t, cam())
    expect(s.parts[0]!.iou).toBe(0)
  })

  it('reports stone marks without putting them in the loss', () => {
    const r = rasterize(piece, cam(), size)
    const a = scoreView(r, prepareTarget(viewOf(r, { marks: [{ x: 64, y: 64, d: 30 }] })), cam())
    const b = scoreView(
      r,
      prepareTarget(
        viewOf(r, {
          marks: [
            { x: 64, y: 64, d: 30 },
            { x: 10, y: 10, d: 4 },
          ],
        }),
      ),
      cam(),
    )
    expect(a.marks).toMatchObject({ matched: 1, missing: 0, extra: 0 })
    expect(b.marks).toMatchObject({ matched: 1, missing: 1, extra: 0 })
    expect(a.loss).toBe(b.loss)
  })

  it('keeps a 96 px copy for the pose search, and averages fitted views', () => {
    const t = prepareTarget(viewOf(rasterize(piece, cam(), { width: 192, height: 144 })))
    expect(t.small?.view.width).toBe(96)
    expect(t.small?.view.height).toBe(72)
    expect(t.small?.small).toBeNull()
    expect(combineLoss([{ loss: 0.2 }, { loss: 0.4 }] as never)).toBeCloseTo(0.3)
  })
})
