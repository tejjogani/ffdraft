import { applyOps, buildDesign, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { opsFor, paramsFor } from './params'

const solitaire = () => buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)

describe('paramsFor', () => {
  it('reads bounds, step and start from the field declarations, through variants', () => {
    const d = solitaire()
    const [w, el, pc] = paramsFor(d, [
      'band.widthTop',
      'center.placement.elevation',
      'head.prongCount',
    ])
    expect(w).toMatchObject({
      key: 'band.widthTop',
      nodeId: 'band',
      path: ['widthTop'],
      min: 1,
      max: 14,
      step: 0.05,
      start: 2,
    })
    expect(el).toMatchObject({
      nodeId: 'center',
      path: ['placement', 'elevation'],
      min: 0,
      max: 8,
      start: 1.2,
    })
    expect(pc!.integer).toBe(true)
  })

  it('narrows to a canon band, to a point for a pin, and records ties', () => {
    const d = solitaire()
    const [w, t] = paramsFor(d, ['band.widthTop', 'band.thicknessTop'], {
      bands: { 'band.widthTop': [2.5, 5] },
      pins: { 'band.thicknessTop': 1.9 },
      ties: { 'band.widthTop': ['band.widthBottom'] },
    })
    expect(w).toMatchObject({ min: 2.5, max: 5, start: 2.5, tie: ['band.widthBottom'] })
    expect(t).toMatchObject({ min: 1.9, max: 1.9, start: 1.9, pinned: true })
  })

  it('refuses keys that are not numeric fields of the node', () => {
    const d = solitaire()
    expect(() => paramsFor(d, ['band.profile'])).toThrow(/not a number/)
    expect(() => paramsFor(d, ['nope.width'])).toThrow(/no node/)
    expect(() => paramsFor(d, ['band.wide'])).toThrow(/no field/)
  })
})

describe('opsFor', () => {
  it('writes ordinary update ops, with ties, rounding, clamping and nested patches', () => {
    const d = solitaire()
    const ps = paramsFor(d, ['band.widthTop', 'center.placement.elevation', 'head.prongCount'], {
      ties: { 'band.widthTop': ['band.widthBottom'] },
    })
    const ops = opsFor(ps, [3.3, 2.5, 5.6])
    const next = applyOps(d, ops).design.nodes as Record<string, Record<string, unknown>>
    expect(next.band).toMatchObject({ widthTop: 3.3, widthBottom: 3.3 })
    expect(next.center!.placement).toMatchObject({ type: 'ringTop', shank: 'band', elevation: 2.5 })
    expect(next.head!.prongCount).toBe(6)
    const clamped = applyOps(d, opsFor(ps, [99, -1, 4])).design.nodes as Record<
      string,
      Record<string, unknown>
    >
    expect(clamped.band!.widthTop).toBe(14)
    expect((clamped.center!.placement as { elevation: number }).elevation).toBe(0)
  })
})
