import { describe, expect, it } from 'vitest'
import type { Evaluation, MeshData } from '../types'
import { writeGlb } from './glb'

const tetra = (): MeshData => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  normals: new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1, 0.577, 0.577, 0.577]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
})

const stoneMatrix = (x: number, s: number) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, 0, 5, 1]

const fixture = (): Evaluation => ({
  detail: 'draft',
  parts: [
    {
      id: 'shank',
      nodeId: 'n-shank',
      name: 'Shank',
      material: 'au18k-yellow',
      finish: 'polished',
      plating: 'none',
      mesh: tetra(),
      edges: new Float32Array(),
      volumeMm3: 1,
      areaMm2: 1,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      exact: false,
    },
  ],
  stones: [0, 1, 2].map((i) => ({
    id: `n-pave:${i}`,
    nodeId: 'n-pave',
    cut: 'round' as const,
    stone: i === 2 ? ('ruby' as const) : ('diamond' as const),
    dims: { length: 1.2, width: 1.2, depth: 0.74 },
    carat: 0.01,
    meshKey: 'round:melee',
    matrix: stoneMatrix(i * 2, 1.2),
    role: 'melee' as const,
    setting: 'pave',
  })),
  gemMeshes: { 'round:melee': tetra() },
  report: {
    metals: [],
    metalMassG: 0,
    lots: [],
    stoneCount: 3,
    caratTotal: 0.03,
    bounds: { min: [0, 0, 0], max: [5, 1, 6] },
  },
  diagnostics: [],
  ms: 0,
  timings: {},
})

interface Gltf {
  asset: { version: string }
  nodes: { name: string; mesh?: number; matrix?: number[]; children?: number[]; extras?: Record<string, unknown> }[]
  meshes: { primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[]
  materials: { name: string }[]
  accessors: { bufferView: number; componentType: number; count: number; min?: number[]; max?: number[] }[]
  bufferViews: { byteOffset: number; byteLength: number }[]
}

function parseGlb(bytes: Uint8Array): { json: Gltf; bin: DataView } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(dv.getUint32(0, true)).toBe(0x46546c67)
  expect(dv.getUint32(4, true)).toBe(2)
  expect(dv.getUint32(8, true)).toBe(bytes.byteLength)
  const jsonLength = dv.getUint32(12, true)
  expect(dv.getUint32(16, true)).toBe(0x4e4f534a)
  expect(jsonLength % 4).toBe(0)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf
  const binStart = 20 + jsonLength
  expect(dv.getUint32(binStart + 4, true)).toBe(0x004e4942)
  const binLength = dv.getUint32(binStart, true)
  return { json, bin: new DataView(bytes.buffer, bytes.byteOffset + binStart + 8, binLength) }
}

function readFloats(g: { json: Gltf; bin: DataView }, accessor: number): number[] {
  const a = g.json.accessors[accessor]!
  const view = g.json.bufferViews[a.bufferView]!
  return Array.from({ length: a.count * 3 }, (_, i) => g.bin.getFloat32(view.byteOffset + i * 4, true))
}

describe('writeGlb', () => {
  it('round-trips nodes, extras, matrices and vertex data', () => {
    const evaluation = fixture()
    const g = parseGlb(writeGlb(evaluation))
    expect(g.json.asset.version).toBe('2.0')

    const root = g.json.nodes[0]!
    expect(root.matrix).toEqual([0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0, 0, 0, 1])
    expect(root.children).toHaveLength(4)

    const shank = g.json.nodes.find((n) => n.name === 'shank')!
    expect(shank.extras).toEqual({
      nodeId: 'n-shank',
      role: 'metal',
      material: 'au18k-yellow',
      finish: 'polished',
      plating: 'none',
    })
    const prim = g.json.meshes[shank.mesh!]!.primitives[0]!
    expect(readFloats(g, prim.attributes.POSITION!)).toEqual(Array.from(evaluation.parts[0]!.mesh.positions))
    expect(g.json.accessors[prim.attributes.POSITION!]!.max).toEqual([1, 1, 1])
    const normals = readFloats(g, prim.attributes.NORMAL!)
    expect(normals[9]).toBeCloseTo(0.577)
    const idx = g.json.accessors[prim.indices]!
    expect(idx.componentType).toBe(5125)
    expect(idx.count).toBe(12)

    const stones = g.json.nodes.filter((n) => n.extras?.role === 'gem')
    expect(stones.map((s) => s.name)).toEqual(['n-pave:0', 'n-pave:1', 'n-pave:2'])
    expect(stones[1]!.matrix).toEqual(stoneMatrix(2, 1.2))
    expect(stones[0]!.extras).toEqual({ nodeId: 'n-pave', role: 'gem', stone: 'diamond', cut: 'round', carat: 0.01 })
    // Same cut and material share one mesh; a different material gets its own.
    expect(stones[0]!.mesh).toBe(stones[1]!.mesh)
    expect(stones[2]!.mesh).not.toBe(stones[0]!.mesh)
    expect(g.json.materials.map((m) => m.name)).toEqual(['au18k-yellow', 'diamond', 'ruby'])
  })

  it('can omit stones', () => {
    const g = parseGlb(writeGlb(fixture(), { stones: false }))
    expect(g.json.nodes).toHaveLength(2)
  })
})
