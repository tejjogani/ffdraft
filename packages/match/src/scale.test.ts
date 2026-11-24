import { applyOps, buildDesign, gemDimsFromCarat, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { applyAnchor, mmPerPixel } from './scale'

const design = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)

describe('applyAnchor', () => {
  it('pins a ring size by an op on the band', () => {
    const d = design('solitaire')
    const a = applyAnchor(d, { type: 'ringSize', nodeId: 'band', size: { system: 'us', value: 8 } })
    expect(a.assumed).toBe(false)
    expect((applyOps(d, a.ops).design.nodes.band as { size: unknown }).size).toEqual({
      system: 'us',
      value: 8,
    })
    expect(a.label).toMatch(/8/)
  })

  it('pins a stone width from carats or millimetres', () => {
    const d = design('solitaire')
    const a = applyAnchor(d, { type: 'stone', nodeId: 'center', carat: 2 })
    expect(a.pins['center.width']).toBeCloseTo(gemDimsFromCarat('round', 2).width)
    expect(applyAnchor(d, { type: 'stone', nodeId: 'center', widthMm: 7 }).pins).toEqual({
      'center.width': 7,
    })
  })

  it('pins a body height, turns a reference object into a span, and says when scale is assumed', () => {
    const d = design('name-pendant')
    expect(applyAnchor(d, { type: 'height', nodeId: 'body', mm: 12 }).pins).toEqual({
      'body.height': 12,
    })
    const r = applyAnchor(d, {
      type: 'reference',
      viewId: 'p1',
      mark: { x: 10, y: 10, d: 40 },
      diameterMm: 20,
      side: 400,
    })
    expect(r.spanMm).toEqual({ viewId: 'p1', span: 200 })
    const none = applyAnchor(d, { type: 'assumed' })
    expect(none.assumed).toBe(true)
    expect(none.ops).toEqual([])
    expect(none.label).toMatch(/assumed/i)
  })

  it('reads millimetres per pixel from the camera', () => {
    expect(
      mmPerPixel(
        {
          azimuth: 0,
          elevation: 0,
          roll: 0,
          distance: 1,
          span: 30,
          shift: [0, 0],
          target: [0, 0, 0],
        },
        { width: 300, height: 150 },
      ),
    ).toBeCloseTo(0.1)
  })
})
