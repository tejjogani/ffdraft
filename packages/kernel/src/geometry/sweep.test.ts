import { beforeAll, describe, expect, it } from 'vitest'
import { QUALITY, runtime } from '../core'
import { loadRuntime } from '../runtime/index'
import { featureEdges, meshVolume } from '../solid/meshing'
import { shapeVolume } from '../solid/occt'
import { chordParameters, cubicSpline } from './bspline'
import { circleLoop, roundedRectLoop, scaleLoop } from './loop'
import { placeLoop, poleSection, sweepSolid } from './sweep'
import { type Frame, frameFromZ } from './vec'

beforeAll(() => loadRuntime())

/** Frame on a circle of radius R in the XZ plane, travelling around +Y. */
const ringFrame = (R: number, a: number): Frame => ({
  origin: [R * Math.sin(a), 0, R * Math.cos(a)],
  x: [0, 1, 0],
  y: [Math.sin(a), 0, Math.cos(a)],
  z: [Math.cos(a), 0, -Math.sin(a)],
})

describe('cubic spline interpolation', () => {
  it('matches OpenCascade for periodic and clamped curves', () => {
    const { oc } = runtime()
    const pts = [0, 1, 2, 3, 4, 5, 6].map((i) => [
      Math.cos(i) * 3 + i,
      Math.sin(2 * i) * 2,
      i * i * 0.1,
    ])
    for (const closed of [true, false]) {
      const flat = new Float64Array(pts.flat())
      const spline = cubicSpline(chordParameters(flat, 3, closed), closed)
      const poles = spline.solve(flat, 3)
      const ocPoles = new oc.NCollection_Array1_gp_Pnt(1, spline.poleCount)
      for (let i = 0; i < spline.poleCount; i++)
        ocPoles.SetValue(i + 1, new oc.gp_Pnt(poles[i * 3]!, poles[i * 3 + 1]!, poles[i * 3 + 2]!))
      const knots = new oc.NCollection_Array1_double(1, spline.knots.length)
      const mults = new oc.NCollection_Array1_int(1, spline.knots.length)
      spline.knots.forEach((k, i) => {
        knots.SetValue(i + 1, k)
        mults.SetValue(i + 1, spline.multiplicities[i]!)
      })
      const curve = new oc.Geom_BSplineCurve(ocPoles, knots, mults, 3, closed)
      const end = spline.knots[spline.knots.length - 1]!
      for (let k = 0; k <= 40; k++) {
        const u = (end * k) / 40
        const b = spline.basisAt(u)
        const mine = [0, 0, 0]
        for (let i = 0; i < 4; i++) {
          const pole = closed ? (b.first + i) % spline.poleCount : b.first + i
          for (let c = 0; c < 3; c++) mine[c]! += b.w[i]! * poles[pole * 3 + c]!
        }
        const theirs = curve.Value(u)
        expect(
          Math.hypot(theirs.X() - mine[0]!, theirs.Y() - mine[1]!, theirs.Z() - mine[2]!),
        ).toBeLessThan(1e-9)
      }
      // The curve interpolates the points at the knots.
      pts.forEach((p, i) => {
        const at = curve.Value(spline.knots[i]!)
        expect(Math.hypot(at.X() - p[0]!, at.Y() - p[1]!, at.Z() - p[2]!)).toBeLessThan(1e-9)
      })
    }
  })
})

describe('sweep', () => {
  it('closed sweep: a torus with exact-quality volume, watertight mesh and valid B-rep', () => {
    const R = 9
    const r = 1
    const n = 48
    const solid = sweepSolid({
      closed: true,
      sections: Array.from({ length: n }, (_, i) =>
        placeLoop(ringFrame(R, (i / n) * 2 * Math.PI), circleLoop(r)),
      ),
    })
    const exact = 2 * Math.PI ** 2 * R * r * r
    // Bézier circles are 0.03 % fat in radius, hence the 1e-3 relative tolerance.
    expect(solid.volume() / exact).toBeCloseTo(1, 3)
    const tris = solid.triangles(QUALITY.draft)
    expect(meshVolume(tris)).toBeGreaterThan(0.97 * exact)
    expect(featureEdges(tris).length).toBe(0)
    expect(solid.manifold(QUALITY.draft).genus()).toBe(1)
    const brep = solid.brep()!
    expect(brep.faces.length).toBe(4)
    expect(solid.exact).toBe(true)
    // The B-rep and the analytic recipe describe the same surface.
    expect(Math.abs(solid.volume() - shapeVolume(brep)) / exact).toBeLessThan(1e-6)
    const t = solid.tessellate(QUALITY.draft)
    expect(t.mesh.normals.length).toBe(t.mesh.positions.length)
    solid.dispose()
  })

  it('open sweep with a flat base, a taper and a domed pole', () => {
    const sections: Float64Array[] = []
    for (const [z, s] of [
      [0, 1],
      [2, 0.9],
      [4, 0.8],
    ] as const)
      sections.push(
        placeLoop(frameFromZ([0, 0, z], [0, 0, 1], [1, 0, 0]), scaleLoop(circleLoop(0.5), s)),
      )
    for (const a of [30, 60]) {
      const c = Math.cos((a * Math.PI) / 180)
      const sn = Math.sin((a * Math.PI) / 180)
      sections.push(
        placeLoop(
          frameFromZ([0, 0, 4 + 0.4 * sn], [0, 0, 1], [1, 0, 0]),
          scaleLoop(circleLoop(0.4), c),
        ),
      )
    }
    sections.push(poleSection([0, 0, 4.4], 4))
    const solid = sweepSolid({ closed: false, sections })
    const m = solid.manifold(QUALITY.production)
    expect(m.genus()).toBe(0)
    expect(m.volume()).toBeGreaterThan(2)
    const brep = solid.brep()!
    expect(Math.abs(shapeVolume(brep) - solid.volume()) / solid.volume()).toBeLessThan(1e-6)
    const b = solid.bounds()
    expect(b.max[2]).toBeCloseTo(4.4, 3)
    solid.dispose()
  })

  it('kinked closed sweep keeps sharp corners', () => {
    // A square frame: rounded-rect wire carried around the corners of a square.
    const half = 5
    const corners: [number, number][] = [
      [half, half],
      [-half, half],
      [-half, -half],
      [half, -half],
    ]
    const sections: Float64Array[] = []
    const kinks: number[] = []
    corners.forEach(([x, y], i) => {
      const [nx, ny] = corners[(i + 1) % 4]!
      kinks.push(sections.length)
      // Mitre: the section at a corner lies in the bisector plane, stretched by √2.
      const diag = Math.SQRT2
      const out: [number, number, number] = [Math.sign(x) / diag, Math.sign(y) / diag, 0]
      sections.push(
        placeLoop(
          { origin: [x, y, 0], x: out, y: [0, 0, 1], z: [0, 0, 0] },
          scaleLoop(roundedRectLoop(1, 1, 0.2), diag, 1),
        ),
      )
      const dir: [number, number, number] = [Math.sign(nx - x), Math.sign(ny - y), 0]
      const side: [number, number, number] = [dir[1], -dir[0], 0]
      sections.push(
        placeLoop(
          { origin: [(x + nx) / 2, (y + ny) / 2, 0], x: side, y: [0, 0, 1], z: dir },
          roundedRectLoop(1, 1, 0.2),
        ),
      )
    })
    const solid = sweepSolid({ closed: true, sections, kinks })
    const area = 1 - (4 - Math.PI) * 0.2 * 0.2
    expect(solid.volume() / (area * 40)).toBeCloseTo(1, 2)
    expect(solid.manifold(QUALITY.draft).genus()).toBe(1)
    expect(Math.abs(shapeVolume(solid.brep()!) - solid.volume()) / solid.volume()).toBeLessThan(
      1e-6,
    )
    solid.dispose()
  })
})

describe('pins', () => {
  it('have an analytic B-rep that matches their mesh', async () => {
    const { pinSolid } = await import('./pin')
    const pin = pinSolid([1, 2, 3], [0, 1, 0], 0.4, 1.2)
    const exact = Math.PI * 0.16 * 1.2 + (2 / 3) * Math.PI * 0.064
    expect(shapeVolume(pin.brep()!)).toBeCloseTo(exact, 6)
    expect(pin.brep()!.faces.length).toBe(3)
    // The sweep's Bézier circles are 0.03 % fat; mesh and B-rep agree to that.
    expect(pin.volume() / exact).toBeCloseTo(1, 2)
    const b = pin.bounds()
    expect([b.min[1], b.max[1]]).toEqual([expect.closeTo(2, 3), expect.closeTo(3.6, 3)])
    expect(b.max[0] - b.min[0]).toBeCloseTo(0.8, 2)
    pin.dispose()
  })
})
