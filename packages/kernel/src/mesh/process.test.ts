import type { Manifold } from 'manifold-3d'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadRuntime, runtime } from '../runtime/index'
import { trianglesFromManifold } from '../solid/solid'
import { TriangleBvh } from './bvh'
import { flatBack, flatPlacement, scaleToHeight } from './fit'
import { distanceGrid, sampleDistance } from './sdf'
import { hollowBody } from './shell'
import { simplifyToDetail } from './simplify'
import { smoothManifold } from './smooth'
import { edgeTopology } from './topology'

beforeAll(() => loadRuntime())
const owned: Manifold[] = []
const own = (m: Manifold) => {
  owned.push(m)
  return m
}
afterEach(() => {
  for (const m of owned.splice(0)) m.delete()
})

const sphere = (r: number, segments = 96) => own(runtime().manifold.Manifold.sphere(r, segments))

describe('mesh processing', () => {
  it('scales to a height and places the back on y = 0, centred', () => {
    const m = own(scaleToHeight(own(runtime().manifold.Manifold.cube([4, 2, 8])), 20))
    const placed = own(m.translate(flatPlacement(m)))
    const b = placed.boundingBox()
    expect(b.max[2] - b.min[2]).toBeCloseTo(20, 9)
    expect(b.max[1]).toBeCloseTo(0, 9)
    expect(b.min[0] + b.max[0]).toBeCloseTo(0, 9)
  })

  it('slices a flat back off a fraction of the depth', () => {
    const cut = own(flatBack(sphere(5), 0.3))
    const b = cut.boundingBox()
    expect(b.max[1]).toBeCloseTo(5 - 0.3 * 10, 6)
    expect(edgeTopology(trianglesFromManifold(cut)).open).toBe(0)
  })

  it('simplifies with less detail, never beyond the silhouette', () => {
    const s = sphere(10, 256)
    const fine = s.numTri()
    const coarse = own(simplifyToDetail(s, 0.1, 20))
    expect(coarse.numTri()).toBeLessThan(fine / 2)
    expect(Math.abs(coarse.volume() - s.volume()) / s.volume()).toBeLessThan(0.05)
    expect(simplifyToDetail(s, 1, 20)).toBe(s)
  })

  it('smooths noise away while keeping the volume (Taubin)', () => {
    const s = sphere(10, 128)
    const noisy = own(
      s.warp((v) => {
        const k = 1 + 0.03 * Math.sin(v[0] * 7) * Math.sin(v[1] * 5) * Math.sin(v[2] * 6)
        v[0] *= k
        v[1] *= k
        v[2] *= k
      }),
    )
    const smooth = own(smoothManifold(noisy, 4))
    const spread = (m: Manifold) => {
      const { positions: p } = trianglesFromManifold(m)
      let lo = Infinity
      let hi = 0
      for (let i = 0; i < p.length; i += 3) {
        const r = Math.hypot(p[i]!, p[i + 1]!, p[i + 2]!)
        lo = Math.min(lo, r)
        hi = Math.max(hi, r)
      }
      return hi - lo
    }
    expect(spread(smooth)).toBeLessThan(spread(noisy) * 0.7)
    expect(smooth.volume() / s.volume()).toBeGreaterThan(0.95)
  })

  it('measures signed distance on a grid', () => {
    const s = sphere(5)
    const grid = distanceGrid(trianglesFromManifold(s), { spacing: 0.25, band: 1, votes: 1 })
    expect(sampleDistance(grid, 0, 0, 4.5)).toBeCloseTo(0.5, 1)
    expect(sampleDistance(grid, 0, 0, 5.3)).toBeCloseTo(-0.3, 1)
    expect(sampleDistance(grid, 0, 0, 0)).toBeCloseTo(1, 6) // clamped to the band
  })

  it('casts rays and finds closest points', () => {
    const bvh = new TriangleBvh(trianglesFromManifold(sphere(5)))
    expect(bvh.raycast(0, 0, 0, 1, 0, 0)).toBeCloseTo(5, 1)
    expect(bvh.raycast(0, 0, 4.99, 0, 0, -1, 0.01)).toBeCloseTo(9.99, 1)
    expect(bvh.crossings(-10, 0.1, 0.2, 1, 0, 0).map((c) => c.w)).toEqual([1, -1])
    const hit = { d2: 0, x: 0, y: 0, z: 0, triangle: -1 }
    expect(bvh.closest(0, 0, 8, hit)).toBe(true)
    expect(Math.sqrt(hit.d2)).toBeCloseTo(3, 1)
    expect(bvh.closest(0, 0, 8, hit, 1)).toBe(false)
  })

  it('hollows a flat-backed body into an open scoop, a closed one with escape holes', () => {
    const envelope = sphere(8)
    const body = own(flatBack(envelope, 0.4))
    const scooped = hollowBody(body, envelope, 1)!
    own(scooped.manifold)
    expect(scooped.open).toBe(true)
    expect(scooped.drains).toBe(0)
    expect(scooped.manifold.volume()).toBeLessThan(body.volume() * 0.5)
    expect(edgeTopology(trianglesFromManifold(scooped.manifold)).open).toBe(0)

    const sealed = hollowBody(envelope, envelope, 1)!
    own(sealed.manifold)
    expect(sealed.open).toBe(false)
    expect(sealed.drains).toBe(2)
    // One shell with holes through it, not a ball with a loose core.
    expect(sealed.manifold.decompose().length).toBe(1)
    expect(sealed.manifold.genus()).toBeGreaterThanOrEqual(1)

    expect(hollowBody(sphere(1), sphere(1), 1)).toBeNull()
  })
})
