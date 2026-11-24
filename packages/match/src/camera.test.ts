// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: the render fixture keeps printed values verbatim
import { describe, expect, it } from 'vitest'
import { cameraBasis, defaultCamera, project, unproject, VIEW_SEEDS } from './camera'
import { boxMesh, fakeEvaluation } from './testkit'
import type { Camera } from './types'

/**
 * Basis vectors printed by `@pave/render`'s `cameraBasis` on 2026-11-24. The camera convention
 * is duplicated here (the package may not import the render layer), and this fixture locks it.
 */
const RENDER_FIXTURE = [
  { a: 0, e: 0, right: [1, 0, 0], up: [0, 0, 1], back: [0, -1, 0] },
  {
    a: 0,
    e: 90,
    right: [1, 0, 0],
    up: [0, 1, 6.123233995736766e-17],
    back: [0, -6.123233995736766e-17, 1],
  },
  {
    a: 45,
    e: 42,
    right: [0.7071067811865476, 0.7071067811865475, 0],
    up: [-0.473146789255815, 0.47314678925581505, 0.7431448254773942],
    back: [0.5254827454987588, -0.5254827454987588, 0.6691306063588582],
  },
  {
    a: 90,
    e: 4,
    right: [6.123233995736766e-17, 1, 0],
    up: [-0.0697564737441253, 4.2713521145274716e-18, 0.9975640502598242],
    back: [0.9975640502598242, -6.108318105475815e-17, 0.0697564737441253],
  },
  {
    a: 180,
    e: 10,
    right: [-1, 1.2246467991473532e-16, 0],
    up: [-2.1265768495757713e-17, -0.17364817766693033, 0.984807753012208],
    back: [1.2060416625018976e-16, 0.984807753012208, 0.17364817766693033],
  },
  {
    a: 0,
    e: -90,
    right: [1, 0, 0],
    up: [0, -1, 6.123233995736766e-17],
    back: [0, -6.123233995736766e-17, -1],
  },
  {
    a: -137,
    e: -23,
    right: [-0.7313537016191705, -0.6819983600624986, 0],
    up: [-0.26647798885505414, 0.2857626571584661, 0.9205048534524405],
    back: [-0.6277828004841349, 0.6732146319308543, -0.39073112848927377],
  },
  {
    a: 300,
    e: 61,
    right: [0.5000000000000001, -0.8660254037844386, 0],
    up: [0.7574428850332227, 0.437309853569698, 0.4848096202463371],
    back: [-0.41985744713241446, -0.2424048101231686, 0.8746197071393957],
  },
]

const cam = (o: Partial<Camera> = {}): Camera => ({
  azimuth: 0,
  elevation: 0,
  roll: 0,
  distance: 100,
  span: 20,
  shift: [0, 0],
  target: [0, 0, 0],
  ...o,
})

describe('camera', () => {
  it('matches the @pave/render camera basis to 1e-12', () => {
    for (const f of RENDER_FIXTURE) {
      const b = cameraBasis(f.a, f.e)
      for (const k of ['right', 'up', 'back'] as const)
        for (let i = 0; i < 3; i++) expect(Math.abs(b[k][i]! - f[k][i]!)).toBeLessThan(1e-12)
    }
  })

  it('maps span to the larger image side at the target depth', () => {
    const size = { width: 200, height: 100 }
    // Front view: right is +X, up is +Z. A point half a span to the right lands on the right edge.
    const p = project(cam(), size, [10, 0, 0])
    expect(p.x).toBeCloseTo(200)
    expect(p.y).toBeCloseTo(50)
    expect(p.depth).toBeCloseTo(100)
    const q = project(cam(), size, [0, 0, 5])
    expect(q.y).toBeCloseTo(0) // up is toward the top of the image
  })

  it('shifts the principal point by fractions of the larger side, and rolls counter-clockwise', () => {
    const size = { width: 100, height: 100 }
    expect(project(cam({ shift: [0.1, -0.2] }), size, [0, 0, 0])).toMatchObject({ x: 60, y: 30 })
    const r = project(cam({ roll: 90 }), size, [5, 0, 0])
    expect(r.x).toBeCloseTo(50)
    expect(r.y).toBeCloseTo(25)
  })

  it('round-trips project and unproject under perspective', () => {
    const c = cam({
      azimuth: 33,
      elevation: -21,
      roll: 7,
      distance: 40,
      span: 17,
      shift: [0.03, -0.04],
      target: [1, 2, 3],
    })
    const size = { width: 160, height: 120 }
    for (const p of [
      [1, 2, 3],
      [4, -3, 9],
      [-6, 5, -2],
    ] as [number, number, number][]) {
      const s = project(c, size, p)
      const back = unproject(c, size, s.x, s.y, s.depth)
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(p[i]!, 9)
    }
  })

  it('frames a piece from a canon view, ten diagonals away', () => {
    const e = fakeEvaluation([{ nodeId: 'a', mesh: boxMesh([-1, -2, -3], [3, 2, 1]) }])
    const c = defaultCamera(e, 'threeQuarter')
    expect([c.azimuth, c.elevation]).toEqual([...VIEW_SEEDS.threeQuarter])
    expect(c.target).toEqual([1, 0, -1])
    expect(c.distance).toBeCloseTo(10 * Math.hypot(4, 4, 4))
    expect(c.span).toBeGreaterThan(Math.hypot(4, 4, 4))
  })
})
