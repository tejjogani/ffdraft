import { describe, expect, it } from 'vitest'
import { box, torus } from '../testing/shapes'
import { TriangleBVH } from './bvh'
import { analyzeTopology, mergeTris } from './mesh'
import { readBinaryStl, writeBinaryStl } from './stl'

describe('mesh topology', () => {
  it('accepts a closed box and measures its volume', () => {
    const b = box([0, 0, 0], [2, 3, 4])
    const t = analyzeTopology(b.positions, b.indices)
    expect(t).toMatchObject({ watertight: true, shells: 1, boundaryEdges: 0, nonManifoldEdges: 0 })
    expect(t.volumeMm3).toBeCloseTo(24, 5)
  })

  it('finds holes, flipped faces and extra shells', () => {
    const b = box([0, 0, 0], [1, 1, 1])
    const open = analyzeTopology(b.positions, b.indices.slice(0, 30))
    expect(open.watertight).toBe(false)
    expect(open.boundaryEdges).toBe(4)

    const flipped = Uint32Array.from(b.indices)
    ;[flipped[1], flipped[2]] = [flipped[2]!, flipped[1]!]
    expect(analyzeTopology(b.positions, flipped).misorientedEdges).toBeGreaterThan(0)

    const two = mergeTris([b, box([3, 0, 0], [4, 1, 1])])
    expect(analyzeTopology(two.positions, two.indices).shells).toBe(2)
  })

  it('reports an internal cavity as a negative-volume shell', () => {
    const outer = box([0, 0, 0], [4, 4, 4])
    const inner = box([1, 1, 1], [3, 3, 3])
    const inv = Uint32Array.from(inner.indices)
    for (let i = 0; i < inv.length; i += 3) [inv[i + 1], inv[i + 2]] = [inv[i + 2]!, inv[i + 1]!]
    const hollow = mergeTris([outer, { positions: inner.positions, indices: inv }])
    const t = analyzeTopology(hollow.positions, hollow.indices)
    expect(t.shellVolumes.filter((v) => v < 0)).toHaveLength(1)
    expect(t.volumeMm3).toBeCloseTo(64 - 8, 4)
  })
})

describe('BVH', () => {
  const t = torus(9, 1)
  const bvh = new TriangleBVH(t)

  it('casts rays to the nearest surface', () => {
    // From the centre outward along +X the band's inner wall is at x = 8.
    const hit = bvh.raycast(0, 0, 0, 1, 0, 0)
    expect(hit!.t).toBeCloseTo(8, 1)
    expect(bvh.raycast(0, 0, 0, 0, 1, 0)).toBeNull()
  })

  it('tests point containment', () => {
    expect(bvh.contains(9, 0, 0)).toBe(true)
    expect(bvh.contains(0, 0, 0)).toBe(false)
    expect(bvh.contains(0, 0, 9.5)).toBe(true)
  })
})

describe('binary STL', () => {
  it('round-trips and stays watertight once unindexed', () => {
    const t = torus(8, 1.2, 64, 24)
    const bytes = writeBinaryStl(t, 'test')
    expect(bytes.length).toBe(84 + (t.indices.length / 3) * 50)
    const back = readBinaryStl(bytes)!
    expect(analyzeTopology(back.positions, back.indices).watertight).toBe(true)
    expect(readBinaryStl(bytes.subarray(0, 100))).toBeNull()
  })
})
