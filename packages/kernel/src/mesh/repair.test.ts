import { beforeAll, describe, expect, it } from 'vitest'
import { loadRuntime } from '../runtime/index'
import type { IndexedTriangles } from '../solid/meshing'
import { trianglesFromManifold } from '../solid/solid'
import { fillHoles } from './fill'
import { orientOutward } from './orient'
import { repairMesh } from './repair'
import { edgeTopology } from './topology'
import { cleanTriangles, weldWithin } from './weld'

beforeAll(() => loadRuntime())

/** An unwelded triangle soup of a UV sphere: every triangle has its own three vertices. */
function sphereSoup(
  radius: number,
  rings = 16,
  segments = 24,
  offset: [number, number, number] = [0, 0, 0],
): number[][] {
  const point = (i: number, j: number): number[] => {
    const theta = (Math.PI * i) / rings
    const phi = (2 * Math.PI * j) / segments
    return [
      offset[0] + radius * Math.sin(theta) * Math.cos(phi),
      offset[1] + radius * Math.sin(theta) * Math.sin(phi),
      offset[2] + radius * Math.cos(theta),
    ]
  }
  const tris: number[][] = []
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segments; j++) {
      const a = point(i, j)
      const b = point(i + 1, j)
      const c = point(i + 1, j + 1)
      const d = point(i, j + 1)
      if (i > 0) tris.push([...a, ...b, ...d])
      if (i < rings - 1) tris.push([...b, ...c, ...d])
    }
  return tris
}

/** An unwelded soup of an outward cube of side 4 with its lowest corner at `min`. */
function cubeSoup(min: [number, number, number]): number[][] {
  const v = (i: number) => [min[0] + (i & 1) * 4, min[1] + ((i >> 1) & 1) * 4, min[2] + ((i >> 2) & 1) * 4]
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ]
  return quads.flatMap(([a, b, c, d]) => [
    [...v(a!), ...v(b!), ...v(c!)],
    [...v(a!), ...v(c!), ...v(d!)],
  ])
}

const soup = (tris: number[][]): IndexedTriangles => ({
  positions: Float32Array.from(tris.flat()),
  indices: Uint32Array.from({ length: tris.length * 3 }, (_, i) => i),
})

const flip = (t: number[]): number[] => [...t.slice(0, 3), ...t.slice(6, 9), ...t.slice(3, 6)]

describe('mesh repair', () => {
  it('welds a soup into a closed surface', () => {
    const welded = weldWithin(soup(sphereSoup(5)), 1e-6)
    const topology = edgeTopology(welded)
    expect(topology.open).toBe(0)
    expect(topology.nonManifold).toBe(0)
  })

  it('drops duplicate and degenerate faces, and internal face pairs', () => {
    const t = [0, 0, 0, 1, 0, 0, 0, 1, 0]
    const cleaned = cleanTriangles(
      weldWithin(
        soup([
          t,
          t,
          flip([0, 0, 1, 1, 0, 1, 0, 1, 1]),
          [0, 0, 1, 1, 0, 1, 0, 1, 1],
          [0, 0, 0, 1, 0, 0, 2, 0, 0],
        ]),
        1e-9,
      ),
    )
    expect(cleaned.indices.length).toBe(3)
  })

  it('orients mixed winding outward and caps holes', () => {
    const tris = sphereSoup(5).map((t, i) => (i % 3 === 0 ? flip(t) : t))
    const holed = tris.filter((_, i) => i !== 40 && i !== 41 && i !== 200)
    const welded = weldWithin(soup(holed), 1e-6)
    const oriented = orientOutward(welded)
    expect(oriented.flipped).toBeGreaterThan(0)
    const filled = fillHoles(oriented.mesh)
    expect(filled.holes).toBe(2)
    const topology = edgeTopology(orientOutward(filled.mesh).mesh)
    expect(topology.open).toBe(0)
    expect(topology.inconsistent).toBe(0)
  })

  it('repairs an inside-out, holed, cracked soup to a manifold of the right volume', () => {
    const tris = sphereSoup(5, 24, 32)
      .map(flip)
      .filter((_, i) => i % 97 !== 5)
    // Float noise along seams (cracks below the weld tolerance).
    const noisy = tris.map((t) => t.map((v, i) => v + (i % 2 ? 1e-5 : -1e-5)))
    const { manifold, report } = repairMesh(soup(noisy))
    expect(report.resurfaced).toBe(false)
    expect(report.holes).toBeGreaterThan(0)
    expect(manifold.volume()).toBeGreaterThan(0.95 * (4 / 3) * Math.PI * 125)
    expect(manifold.volume()).toBeLessThan((4 / 3) * Math.PI * 125)
    manifold.delete()
  })

  it('fuses overlapping shells', () => {
    const { manifold, report } = repairMesh(
      soup([...sphereSoup(5), ...sphereSoup(5, 16, 24, [4, 0, 0])]),
    )
    expect(report.shells).toBe(2)
    expect(manifold.decompose().length).toBe(1)
    expect(manifold.volume()).toBeLessThan(2 * (4 / 3) * Math.PI * 125)
    manifold.delete()
  })

  it('drops a fin standing on an edge as debris', () => {
    const sphere = sphereSoup(5)
    const t = sphere[100]!
    const fin = [...t.slice(0, 6), t[0]! * 1.6, t[1]! * 1.6, t[2]! * 1.6 + 1]
    const { manifold, report } = repairMesh(soup([...sphere, fin]))
    expect(report.fragments).toBe(1)
    expect(report.resurfaced).toBe(false)
    expect(manifold.volume()).toBeGreaterThan(0.9 * (4 / 3) * Math.PI * 125)
    manifold.delete()
  })

  it('re-surfaces non-manifold input, and refuses what encloses nothing', () => {
    // Two closed cubes touching along one edge: that edge has four faces.
    const { manifold, report } = repairMesh(soup([...cubeSoup([0, 0, 0]), ...cubeSoup([4, 4, 0])]))
    expect(report.resurfaced).toBe(true)
    expect(edgeTopology(trianglesFromManifold(manifold)).open).toBe(0)
    expect(manifold.volume()).toBeGreaterThan(0.85 * 2 * 64)
    manifold.delete()
    // A flat disc: capping its rim encloses nothing.
    const disc = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * 2 * Math.PI
      const b = ((i + 1) / 16) * 2 * Math.PI
      return [0, 0, 0, Math.cos(a), Math.sin(a), 0, Math.cos(b), Math.sin(b), 0]
    })
    expect(() => repairMesh(soup(disc))).toThrow(/enclose a volume/)
  })
})
