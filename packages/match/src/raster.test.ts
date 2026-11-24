import { describe, expect, it } from 'vitest'
import { project } from './camera'
import { rasterize, triangleAt } from './raster'
import { boxMesh, count, fakeEvaluation, sphereMesh } from './testkit'
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
const size = { width: 192, height: 192 }

describe('rasterize', () => {
  it('draws a sphere with the area of its perspective silhouette, within 1 %', () => {
    const r = 5
    const e = fakeEvaluation([{ nodeId: 'ball', mesh: sphereMesh([0, 0, 0], r, 96) }])
    for (const c of [cam(), cam({ azimuth: 70, elevation: 35, distance: 40 })]) {
      const out = rasterize(e, c, size)
      const f = (192 * c.distance) / c.span
      const apparent = (f * r) / Math.sqrt(c.distance ** 2 - r ** 2)
      expect(count(out.cls) / (Math.PI * apparent ** 2)).toBeGreaterThan(0.99)
      expect(count(out.cls) / (Math.PI * apparent ** 2)).toBeLessThan(1.01)
    }
  })

  it('draws a box as exactly the pixel centres inside its nearest face', () => {
    const e = fakeEvaluation([{ nodeId: 'box', mesh: boxMesh([-4, -2, -3], [4, 2, 3]) }])
    const c = cam({ distance: 60 })
    // The face at y = −2 is nearest the camera at −Y; its corners bound the silhouette.
    const lo = project(c, size, [-4, -2, 3])
    const hi = project(c, size, [4, -2, -3])
    const centres = (a: number, b: number) => Math.floor(b - 0.5) - Math.ceil(a - 0.5) + 1
    const expected = centres(lo.x, hi.x) * centres(lo.y, hi.y)
    expect(count(rasterize(e, c, size).cls)).toBe(expected)
    // Pixel quantisation alone keeps it within 2 % of the continuous area at this size.
    expect(Math.abs(expected / ((hi.x - lo.x) * (hi.y - lo.y)) - 1)).toBeLessThan(0.02)
  })

  it('keeps the nearest surface, labels stones 2, and names the node per pixel', () => {
    const e = fakeEvaluation(
      [{ nodeId: 'plate', mesh: boxMesh([-6, 0, -6], [6, 1, 6]) }],
      [{ nodeId: 'gem', at: [0, -2, 0], width: 4 }],
    )
    const out = rasterize(e, cam(), size, { depth: true, face: true })
    const mid = 96 * 192 + 96
    expect(out.cls[mid]).toBe(2)
    expect(out.nodeIds[out.node[mid]! - 1]).toBe('gem')
    expect(out.depth![mid]).toBeCloseTo(200 - 4, 0) // the front of the stone, at y = −4
    const corner = project(cam(), size, [5, 0, 5])
    const k = Math.floor(corner.y) * 192 + Math.floor(corner.x)
    expect(out.cls[k]).toBe(1)
    expect(out.nodeIds[out.node[k]! - 1]).toBe('plate')
    expect(out.depth![k]).toBeCloseTo(200, 3)
    const tri = triangleAt(e, out.face![k]!, [])
    expect(tri.nodeId).toBe('plate')
    expect(out.cls[0]).toBe(0)
    expect(out.face![0]).toBe(-1)
  })

  it('leaves hidden nodes out', () => {
    const e = fakeEvaluation(
      [{ nodeId: 'plate', mesh: boxMesh([-6, 0, -6], [6, 1, 6]) }],
      [{ nodeId: 'gem', at: [0, -2, 0], width: 4 }],
    )
    const out = rasterize(e, cam(), size, { hide: ['gem'] })
    expect(out.cls.some((v) => v === 2)).toBe(false)
    expect(count(rasterize(e, cam(), size, { hide: ['gem', 'plate'] }).cls)).toBe(0)
  })

  it('renders 10k triangles at 192 px quickly', () => {
    const e = fakeEvaluation([{ nodeId: 'ball', mesh: sphereMesh([0, 0, 0], 5, 100) }])
    expect(e.parts[0]!.mesh.indices.length / 3).toBeGreaterThanOrEqual(10_000)
    rasterize(e, cam(), size)
    const t = performance.now()
    for (let i = 0; i < 20; i++) rasterize(e, cam({ azimuth: i }), size)
    // The floor is 4 ms for a render plus a score; this machine is shared, so allow slack here.
    expect((performance.now() - t) / 20).toBeLessThan(8)
  })
})
