/**
 * Failing safely, without a kernel: refused targets, the stone mask that is supplied but empty,
 * the loose overlap, non-square views, near-plane clipping, cancellation from a timer and the
 * time budget. The kernel-backed cases (a wrong recipe, weak numbers, two open fields) are in
 * fit.test.ts and loop.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { project, toRenderCamera } from './camera'
import { fitDesign } from './fit'
import { makeGuard, Stop } from './guard'
import { template } from './kernel.testkit'
import { paramsFor } from './params'
import { principalAxis } from './pose'
import { rasterize } from './raster'
import { checkTarget, prepareTarget, scoreView, underFloor } from './score'
import { boxMesh, count, fakeEvaluation } from './testkit'
import type { Camera, Evaluate, LabelRaster, TargetView } from './types'

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
const plate = fakeEvaluation([{ nodeId: 'plate', mesh: boxMesh([-6, 0, -4], [6, 1, 4]) }])
const withGem = fakeEvaluation(
  [{ nodeId: 'plate', mesh: boxMesh([-6, 0, -4], [6, 1, 4]) }],
  [{ nodeId: 'gem', at: [0, -2, 0], width: 4 }],
)
const viewOf = (r: LabelRaster, o: Partial<TargetView> = {}): TargetView => ({
  id: 'v',
  width: r.width,
  height: r.height,
  matte: r.cls.map((v) => (v ? 1 : 0)),
  stones: r.cls.map((v) => (v === 2 ? 1 : 0)),
  ...o,
})
const blank = (fill: number, w = 96, h = 96): TargetView => ({
  id: 'v',
  width: w,
  height: h,
  matte: new Uint8Array(w * h).fill(fill),
  stones: new Uint8Array(w * h),
})

describe('targets no fit can explain are refused before any build', () => {
  it('refuses empty, one-pixel, full and border-to-border mattes, and accepts a piece', () => {
    const one = blank(0)
    one.matte[48 * 96 + 48] = 1
    const frame = blank(0)
    for (let k = 0; k < 96; k++) {
      frame.matte[k] = 1 // top row
      frame.matte[95 * 96 + k] = 1 // bottom row
      frame.matte[k * 96] = 1 // left column
      frame.matte[k * 96 + 95] = 1 // right column
    }
    for (const v of [blank(0), one, blank(1), frame])
      expect(checkTarget(v)).toMatchObject({ level: 'error', code: 'match.badTarget' })
    expect(checkTarget(viewOf(rasterize(plate, cam(), size)))).toBeNull()
  })

  it('returns `rejected` and `failed` without calling the kernel', async () => {
    let calls = 0
    const evaluate: Evaluate = async () => {
      calls++
      return plate
    }
    const design = template('solitaire')
    const params = paramsFor(design, ['band.widthTop'])
    for (const v of [blank(0), blank(1)]) {
      const r = await fitDesign({ design, params, views: [v], evaluate })
      expect(r.stopped).toBe('rejected')
      expect(r.quality).toBe('failed')
      expect(r.params[0]!.status).toBe('assumed')
      expect(r.diagnostics.map((d) => d.code)).toContain('match.badTarget')
    }
    expect(calls).toBe(0)
  })
})

describe('scores that cannot be gamed', () => {
  it('an empty stone mask is evidence: a drawn stone scores stone overlap 0', () => {
    const r = rasterize(withGem, cam(), size)
    const noStones = viewOf(rasterize(plate, cam(), size)) // stones: all zeros
    const s = scoreView(r, prepareTarget(noStones), cam())
    expect(s.stoneIou).toBe(0)
    expect(underFloor(s)).toMatch(/stone overlap/)
    // Without a stone mask the stone terms are dropped.
    const { stones: _, ...looked } = noStones
    expect(scoreView(r, prepareTarget(looked), cam()).stoneIou).toBeNull()
    // The plate alone against the same empty mask: stones agree (none and none).
    const p = scoreView(rasterize(plate, cam(), size), prepareTarget(noStones), cam())
    expect(p.stoneIou).toBe(1)
    expect(p.loss).toBeLessThan(s.loss)
  })

  it('a render that draws nothing explains nothing', () => {
    const empty = rasterize(plate, cam({ target: [500, 0, 0] }), size)
    expect(count(empty.cls)).toBe(0)
    const s = scoreView(empty, prepareTarget(viewOf(empty)), cam())
    expect(s.iou).toBe(0)
    expect(s.looseIou).toBe(0)
  })

  it('the loose overlap forgives a pixel of outline error, not a miss', () => {
    const t = prepareTarget(viewOf(rasterize(plate, cam(), size)))
    const nudged = scoreView(rasterize(plate, cam({ shift: [1 / 128, 0] }), size), t, cam())
    expect(nudged.iou).toBeLessThan(1)
    expect(nudged.looseIou).toBe(1)
    const off = scoreView(rasterize(plate, cam({ shift: [0.2, 0] }), size), t, cam())
    expect(off.looseIou).toBeLessThan(0.9)
  })

  it('scales the outline distance by the larger side of a non-square view', () => {
    // 64 wide, 128 tall: the old cap of width / 4 = 16 px hid a miss of 26 px and more.
    const tall = { width: 64, height: 128 }
    const c = cam({ span: 40 })
    const t = prepareTarget(viewOf(rasterize(plate, c, tall)))
    const s = scoreView(rasterize(plate, cam({ span: 40, shift: [0, 0.4] }), tall), t, c)
    expect(s.edgePx).toBeGreaterThan(16)
  })
})

describe('rasterize near the camera', () => {
  it('clips at the near plane instead of dropping triangles: a camera inside a box sees its walls', () => {
    const room = fakeEvaluation([{ nodeId: 'room', mesh: boxMesh([-50, -50, -50], [50, 50, 50]) }])
    const r = rasterize(room, cam({ distance: 10, span: 10 }), { width: 64, height: 64 })
    expect(count(r.cls)).toBe(64 * 64)
  })
})

describe('cancellation and the time budget reach a synchronous search', () => {
  // A kernel stub that answers at once, so the cost is all rendering, like an in-process kernel.
  const evaluate: Evaluate = async () => plate
  const design = template('solitaire')
  const params = paramsFor(design, ['band.widthTop'])
  const target = viewOf(rasterize(plate, cam({ azimuth: 30, elevation: 20 }), size))

  it('aborts from a timer while the pose search runs', async () => {
    const ctl = new AbortController()
    const t0 = performance.now()
    setTimeout(() => ctl.abort(), 30)
    const r = await fitDesign({ design, params, views: [target], evaluate, signal: ctl.signal })
    expect(r.stopped).toBe('aborted')
    expect(performance.now() - t0).toBeLessThan(1500)
  })

  it('stops at the time budget', async () => {
    const t0 = performance.now()
    const r = await fitDesign({ design, params, views: [target], evaluate, budget: { ms: 60 } })
    expect(r.stopped).toBe('budget')
    expect(performance.now() - t0).toBeLessThan(1500)
  })

  it('a guard throws on abort and on the deadline', async () => {
    const ctl = new AbortController()
    const g = makeGuard(ctl.signal)
    await g.tick()
    ctl.abort()
    await expect(g.tick()).rejects.toBeInstanceOf(Stop)
    expect(() => makeGuard(undefined, performance.now() - 1).check()).toThrow(Stop)
  })
})

describe('camera helpers', () => {
  it('reads a turned photo: the principal axis turns with the roll', () => {
    const a = principalAxis(rasterize(plate, cam(), size).cls, size)
    const b = principalAxis(rasterize(plate, cam({ roll: 30 }), size).cls, size)
    expect(a.elongation).toBeGreaterThan(0.3)
    expect(Math.abs(b.angle - a.angle - 30)).toBeLessThan(2)
  })

  it('converts a fitted camera for the render layer, flagging what it cannot hold', () => {
    const c = cam({ roll: 0, shift: [0, 0] })
    const r = toRenderCamera(c, size)
    // Same image scale: f_px = N · focalLength / sensorWidth = N · distance / span.
    expect((128 * r.camera.focalLength) / r.camera.sensorWidth).toBeCloseTo((128 * 200) / 20)
    expect(r.exact).toBe(true)
    const p = project(c, size, [3, 0, 2])
    expect(p.x).toBeCloseTo(64 + (128 * 200 * 3) / 20 / 200)
    const turned = toRenderCamera(cam({ roll: 5, shift: [0.01, 0] }), size)
    expect(turned.exact).toBe(false)
    expect(turned.rollDeg).toBe(5)
    expect(turned.shiftPx[0]).toBeCloseTo(1.28)
  })
})
