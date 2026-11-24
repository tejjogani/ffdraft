import { applyOps } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { boundsDiagonal, visibleBounds } from './camera'
import { chooseDiscrete } from './choose'
import { fitDesign } from './fit'
import { draftKernel, template } from './kernel.testkit'
import { observability, suggestView } from './observe'
import { opsFor, paramsFor } from './params'
import { searchPose } from './pose'
import { rasterize } from './raster'
import { prepareTarget } from './score'
import type { Camera, Evaluation, TargetView } from './types'

const k = draftKernel()

/**
 * The solitaire with the claw wire the pose and fit thresholds were tuned on (0.97 mm, the
 * recipe's value before claws followed the stone's rule of 1.0 mm). The searches are sensitive
 * to the claws' silhouette; re-tune the thresholds before dropping the pin.
 */
const solitaire = () =>
  applyOps(template('solitaire'), [{ t: 'update', id: 'head', patch: { prongDiameter: 0.97 } }])
    .design

function viewFrom(
  e: Evaluation,
  c: Camera,
  side: number,
  id = 'v',
  hide: string[] = [],
): TargetView {
  const r = rasterize(e, c, { width: side, height: side }, { hide })
  return {
    id,
    width: side,
    height: side,
    matte: r.cls.map((v) => (v ? 1 : 0)),
    stones: r.cls.map((v) => (v === 2 ? 1 : 0)),
  }
}

const bounds = (e: Evaluation) => {
  const b = e.report.bounds
  const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
  const target: [number, number, number] = [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ]
  return { diag, target }
}

const angleErr = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180)

describe('pose and fit on a real kernel (draft solitaire)', () => {
  it('finds the camera of one view from scratch', async () => {
    const e = await k.evaluate(solitaire())
    const { diag, target } = bounds(e)
    const truth: Camera = {
      azimuth: 38,
      elevation: 33,
      roll: 4,
      distance: diag * 10,
      span: diag / 0.62,
      shift: [0.02, -0.03],
      target,
    }
    const t = prepareTarget(viewFrom(e, truth, 192))
    const t0 = performance.now()
    const r = await searchPose(e, t)
    const ms = performance.now() - t0
    // The solitaire is mirror-symmetric in X and in Y: az, −az, 180 − az and 180 + az draw the same.
    const twins = [
      r.camera.azimuth,
      -r.camera.azimuth,
      180 - r.camera.azimuth,
      180 + r.camera.azimuth,
    ]
    expect(Math.min(...twins.map((a) => angleErr(a, truth.azimuth)))).toBeLessThan(2)
    expect(Math.abs(r.camera.elevation - truth.elevation)).toBeLessThan(2)
    expect(r.score.iou).toBeGreaterThan(0.97)
    // Floor: 4 s on an idle machine; this one is shared with other agents.
    expect(ms).toBeLessThan(12_000)
  })

  it('recovers band width and stone size with a known camera, as ordinary ops', async () => {
    const start = solitaire()
    const params = paramsFor(start, ['band.widthTop', 'center.width'], {
      bands: { 'band.widthTop': [1.5, 4.5], 'center.width': [5, 9] },
      ties: { 'band.widthTop': ['band.widthBottom'] },
    })
    const truthDesign = applyOps(start, opsFor(params, [3.4, 7.6])).design
    const e = await k.evaluate(truthDesign)
    const { diag, target } = bounds(e)
    const cam: Camera = {
      azimuth: 30,
      elevation: 40,
      roll: 0,
      distance: diag * 10,
      span: diag / 0.66,
      shift: [0, 0],
      target,
    }
    const view = viewFrom(e, cam, 128)
    const r = await fitDesign({
      design: start,
      params,
      views: [view],
      evaluate: k.evaluate,
      cameras: { v: cam },
      budget: { evaluations: 60 },
    })
    const v = Object.fromEntries(r.params.map((p) => [p.key, p.value]))
    expect(Math.abs(v['band.widthTop']! - 3.4)).toBeLessThan(0.2)
    expect(Math.abs(v['center.width']! - 7.6)).toBeLessThan(0.2)
    expect(r.scores.v!.iou).toBeGreaterThan(0.97)
    expect(r.evaluations).toBeLessThanOrEqual(60)
    expect(r.ops.every((o) => o.t === 'update')).toBe(true)
    const again = applyOps(start, r.ops).design.nodes.band as {
      widthTop: number
      widthBottom: number
    }
    expect(again.widthBottom).toBe(again.widthTop)
    // Same inputs, same result.
    const r2 = await fitDesign({
      design: start,
      params,
      views: [view],
      evaluate: k.evaluate,
      cameras: { v: cam },
      budget: { evaluations: 60 },
    })
    expect(r2.params).toEqual(r.params)
    expect(r2.loss).toBe(r.loss)
  })

  it('never returns an invalid start as converged, and stops on abort', async () => {
    const start = solitaire()
    const e = await k.evaluate(start)
    const { diag, target } = bounds(e)
    const cam: Camera = {
      azimuth: 30,
      elevation: 40,
      roll: 0,
      distance: diag * 10,
      span: diag / 0.66,
      shift: [0, 0],
      target,
    }
    const view = viewFrom(e, cam, 96)
    const params = paramsFor(start, ['band.widthTop'])
    const broken = async () => ({
      ...e,
      diagnostics: [{ level: 'error' as const, code: 'x', message: 'x' }],
    })
    const r = await fitDesign({
      design: start,
      params,
      views: [view],
      evaluate: broken,
      cameras: { v: cam },
    })
    expect(r.stopped).not.toBe('converged')
    expect(r.diagnostics.some((d) => d.code === 'match.invalidStart')).toBe(true)
    const ctl = new AbortController()
    let n = 0
    const counting = async (d: Parameters<typeof k.evaluate>[0]) => {
      if (++n === 3) ctl.abort()
      return k.evaluate(d)
    }
    const a = await fitDesign({
      design: start,
      params,
      views: [view],
      evaluate: counting,
      cameras: { v: cam },
      signal: ctl.signal,
    })
    expect(a.stopped).toBe('aborted')
    expect(a.evaluations).toBe(3)
  })

  it('decides the prong count by building both, with a margin', async () => {
    const start = solitaire()
    const truth = applyOps(start, [{ t: 'update', id: 'head', patch: { prongCount: 6 } }]).design
    const e = await k.evaluate(truth)
    const { diag, target } = bounds(e)
    const cam: Camera = {
      azimuth: 20,
      elevation: 70,
      roll: 0,
      distance: diag * 10,
      span: diag / 0.66,
      shift: [0, 0],
      target,
    }
    const view = viewFrom(e, cam, 128)
    const params = paramsFor(start, ['head.prongDiameter'], {
      bands: { 'head.prongDiameter': [0.7, 1.3] },
    })
    const c = await chooseDiscrete({
      design: start,
      params,
      views: [view],
      evaluate: k.evaluate,
      cameras: { v: cam },
      budget: { evaluations: 20 },
      candidates: [
        { id: '4', ops: [{ t: 'update', id: 'head', patch: { prongCount: 4 } }] },
        { id: '6', ops: [{ t: 'update', id: 'head', patch: { prongCount: 6 } }] },
      ],
    })
    expect(c.ranked[0]!.id).toBe('6')
    expect(c.margin).toBeGreaterThan(1.5)
    expect(c.decided).toBe(true)
    expect(c.ranked[0]!.result.ops[0]).toEqual({
      t: 'update',
      id: 'head',
      patch: { prongCount: 6 },
    })
  })

  it('marks a number no fitted view can see as assumed, and suggests the view that would see it', async () => {
    const start = solitaire()
    const e = await k.evaluate(start)
    const { diag, target } = bounds(e)
    const cam: Camera = {
      azimuth: 30,
      elevation: 40,
      roll: 0,
      distance: diag * 10,
      span: diag / 0.66,
      shift: [0, 0],
      target,
    }
    // With the head hidden, its prong diameter cannot change any pixel.
    const view = viewFrom(e, cam, 96, 'v', ['head'])
    const params = paramsFor(start, ['band.widthTop', 'head.prongDiameter'])
    const input = {
      design: start,
      params,
      views: [view],
      evaluate: k.evaluate,
      cameras: { v: cam },
      hide: ['head'],
      budget: { evaluations: 12 },
    }
    const r = await observability(await fitDesign(input), input)
    const byKey = Object.fromEntries(r.params.map((p) => [p.key, p]))
    expect(byKey['head.prongDiameter']).toMatchObject({
      status: 'assumed',
      sensitivity: 0,
      value: params[1]!.start,
    })
    expect(byKey['band.widthTop']!.status).not.toBe('assumed')
    expect(byKey['band.widthTop']!.status).not.toBe('weak')
    expect(byKey['band.widthTop']!.sensitivity).toBeGreaterThan(0)

    // Head height: a top view barely sees it; a side or front view does.
    const [height] = paramsFor(start, ['center.placement.elevation'])
    const ranked = await suggestView(start, [height!], k.evaluate)
    expect(ranked[0]!.seed).not.toBe('top')
    expect(ranked.find((x) => x.seed === 'side')!.gain).toBeGreaterThan(
      ranked.find((x) => x.seed === 'top')!.gain,
    )
  })

  it('marks head height weak from a top view: the camera absorbs it, so it is not observable', async () => {
    const start = solitaire()
    const params = paramsFor(start, ['band.widthTop', 'center.placement.elevation'], {
      bands: { 'band.widthTop': [1.6, 4], 'center.placement.elevation': [0.5, 3] },
      ties: { 'band.widthTop': ['band.widthBottom'] },
    })
    const e = await k.evaluate(applyOps(start, opsFor(params, [3, 2.4])).design)
    const { diag, target } = bounds(e)
    const cam: Camera = {
      azimuth: 10,
      elevation: 86,
      roll: 0,
      distance: diag * 10,
      span: diag / 0.62,
      shift: [0, 0],
      target,
    }
    const input = {
      design: start,
      params,
      views: [viewFrom(e, cam, 128)],
      evaluate: k.evaluate,
      cameras: { v: cam },
      budget: { evaluations: 40, reserve: 6 },
    }
    const r = await observability(await fitDesign(input), input)
    const byKey = Object.fromEntries(r.params.map((p) => [p.key, p]))
    expect(['weak', 'assumed']).toContain(byKey['center.placement.elevation']!.status)
    expect(byKey['center.placement.elevation']!.uncertainty).toBeGreaterThan(0.5)
    expect(byKey['band.widthTop']!.status).toBe('fitted')
    expect(Math.abs(byKey['band.widthTop']!.value - 3)).toBeLessThan(0.25)
    expect(r.evaluations).toBeLessThanOrEqual(40)
  })

  it('hops out of the thickness and head-height valley a coordinate search stalls in', async () => {
    // Regression: without restarts this case stopped at loss 0.026 (head height 1.95 against 2.4).
    const start = solitaire()
    const params = paramsFor(
      start,
      ['band.widthTop', 'center.placement.elevation', 'band.thicknessTop'],
      {
        bands: {
          'band.widthTop': [1.6, 4],
          'center.placement.elevation': [0.5, 3],
          'band.thicknessTop': [1.3, 2.6],
        },
        ties: { 'band.widthTop': ['band.widthBottom'] },
      },
    )
    const e = await k.evaluate(applyOps(start, opsFor(params, [3, 2.4, 2.2])).design)
    const { diag, target } = bounds(e)
    const cam: Camera = {
      azimuth: 40,
      elevation: 38,
      roll: 0,
      distance: diag * 10,
      span: diag / 0.62,
      shift: [0, 0],
      target,
    }
    const r = await fitDesign({
      design: start,
      params,
      views: [viewFrom(e, cam, 128)],
      evaluate: k.evaluate,
      cameras: { v: cam },
    })
    const v = Object.fromEntries(r.params.map((p) => [p.key, p.value]))
    expect(r.loss).toBeLessThan(0.015)
    expect(Math.abs(v['center.placement.elevation']! - 2.4)).toBeLessThan(0.3)
    expect(Math.abs(v['band.thicknessTop']! - 2.2)).toBeLessThan(0.3)
  })

  it('a photo of a piece the recipe cannot draw ends poor, never converged', async () => {
    // A wedding band read as a solitaire: the photo shows no stones, the recipe draws one.
    const band = await k.evaluate(template('wedding-band'))
    const { diag, target } = bounds(band)
    const cam: Camera = {
      azimuth: 40,
      elevation: 38,
      roll: 3,
      distance: diag * 10,
      span: diag / 0.62,
      shift: [0, 0],
      target,
    }
    const start = solitaire()
    const r = await fitDesign({
      design: start,
      params: paramsFor(start, ['center.width'], { bands: { 'center.width': [5, 9] } }),
      views: [viewFrom(band, cam, 96)],
      evaluate: k.evaluate,
      budget: { evaluations: 8 },
    })
    expect(r.quality).toBe('poor')
    expect(r.stopped).not.toBe('converged')
    expect(r.diagnostics.map((d) => d.code)).toContain('match.poorFit')
  })

  it('finds a photo turned by 90 degrees', async () => {
    const e = await k.evaluate(template('pendant-solitaire'))
    const hide = ['chain']
    const b = visibleBounds(e, hide)
    const diag = boundsDiagonal(b)
    const truth: Camera = {
      azimuth: 40,
      elevation: 38,
      roll: 90,
      distance: diag * 10,
      span: diag / 0.62,
      shift: [0, 0],
      target: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
    }
    const r = await searchPose(e, prepareTarget(viewFrom(e, truth, 192, 'v', hide)), { hide })
    expect(r.found).toBe(true)
    expect(r.score.iou).toBeGreaterThan(0.95)
  })
})
