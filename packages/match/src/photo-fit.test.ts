import { applyOps } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { draftKernel, template } from './kernel.testkit'
import { subjectMatte } from './matte'
import { fitToPhoto, photoFitPlan } from './photo-fit'
import { shade, viewCamera } from './shade'

describe('fitToPhoto', () => {
  it('plans the outline numbers a solitaire has, with the band sides tied', () => {
    const plan = photoFitPlan(template('solitaire'))
    expect(plan.params.map((p) => p.key)).toEqual([
      'center.width',
      'band.widthTop',
      'band.thicknessTop',
      'head.prongDiameter',
    ])
    expect(plan.params.find((p) => p.key === 'band.widthTop')?.tie).toEqual(['band.widthBottom'])
  })

  it('moves a solitaire toward the piece in a synthetic photo (truth known)', async () => {
    const k = draftKernel()
    const start = template('solitaire')
    const c = start.nodes.center as { width: number }
    const b = start.nodes.band as { widthTop: number }
    const truthWidth = c.width * 1.18
    const truthBand = b.widthTop * 1.3
    const truth = applyOps(start, [
      { t: 'update', id: 'center', patch: { width: truthWidth } },
      { t: 'update', id: 'band', patch: { widthTop: truthBand, widthBottom: truthBand } },
    ] as never).design
    const e = await k.evaluate(truth)
    const size = { width: 320, height: 320 }
    const rgba = shade(e, viewCamera(e, 'threeQuarter'), size, { background: [250, 250, 248] })
    const m = subjectMatte(rgba, size)
    expect(m.plain).toBe(true)
    const out = await fitToPhoto({
      design: start,
      matte: m.matte,
      ...size,
      view: 'threeQuarter',
      evaluate: k.evaluate,
      budgetMs: 40_000,
    })
    expect(out.result.quality).toBe('good')
    expect(out.overlap).toBeGreaterThan(0.9)
    const fitted = out.params.find((p) => p.key === 'center.width')!
    // Closer to the truth than the recipe's start was.
    expect(Math.abs(fitted.to - truthWidth)).toBeLessThan(Math.abs(fitted.from - truthWidth))
    expect(out.result.ops.length).toBeGreaterThan(0)
  }, 120_000)

  it('stops when cancelled and reports it', async () => {
    const k = draftKernel()
    const start = template('solitaire')
    const e = await k.evaluate(start)
    const size = { width: 192, height: 192 }
    const m = subjectMatte(shade(e, viewCamera(e, 'top'), size), size)
    const ac = new AbortController()
    ac.abort()
    const out = await fitToPhoto({
      design: start,
      matte: m.matte,
      ...size,
      evaluate: k.evaluate,
      budgetMs: 10_000,
      signal: ac.signal,
    })
    expect(out.result.stopped).toBe('aborted')
  }, 60_000)
})
