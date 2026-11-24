import { describe, expect, it } from 'vitest'
import { diffClasses, edgeHeat } from './overlay'
import { rasterize } from './raster'
import { prepareTarget } from './score'
import { boxMesh, fakeEvaluation } from './testkit'
import type { Camera } from './types'

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
const size = { width: 64, height: 64 }
const e = fakeEvaluation([{ nodeId: 'box', mesh: boxMesh([-5, 0, -5], [5, 1, 5]) }])

describe('overlay', () => {
  it('tints both, model only and photo only', () => {
    const t = rasterize(e, cam(), size)
    const prep = prepareTarget({ id: 'v', ...size, matte: t.cls.map((v) => (v ? 1 : 0)) })
    const moved = rasterize(e, cam({ shift: [4 / 64, 0] }), size)
    const d = diffClasses(moved, prep)
    const at = (x: number, y: number) => d[y * 64 + x]
    expect(at(32, 32)).toBe(1)
    expect(at(0, 0)).toBe(0)
    // The box spans x 16..48 in the photo and 20..52 in the model.
    expect(at(17, 32)).toBe(3)
    expect(at(50, 32)).toBe(2)
  })

  it('gives each model edge pixel its distance to the photo outline in mm', () => {
    const t = rasterize(e, cam(), size)
    const prep = prepareTarget({ id: 'v', ...size, matte: t.cls.map((v) => (v ? 1 : 0)) })
    const c = cam({ shift: [4 / 64, 0] })
    const h = edgeHeat(rasterize(e, c, size), prep, c)
    const mmPerPx = 20 / 64
    expect(h[32 * 64 + 51]).toBeCloseTo(4 * mmPerPx) // right edge, four pixels out
    expect(h[32 * 64 + 32]).toBe(-1) // not an edge
  })
})
