/**
 * Dependency-free glTF 2.0 binary writer for an Evaluation — the transport to the Blender render
 * worker and to any glTF viewer (docs/research/03-rendering.md §4 "Geometry transport: GLB").
 *
 * - One node per metal part, named by part id; one node per stone, named by stone id, with
 *   stones of the same `meshKey` sharing one mesh. Node `extras` carry what renderers need to
 *   assign materials: `{ nodeId, role: 'metal', material, finish, plating }` or
 *   `{ nodeId, role: 'gem', stone, cut, carat }`.
 * - A root node converts the kernel's Z-up millimetres to glTF's Y-up metres, so every child
 *   keeps kernel coordinates and stone matrices are written verbatim.
 * - Normals are written as authored (flat facets on gems, smoothed metals); importers must not
 *   recompute them. No Draco or meshopt: bpy's importer cannot decode either (research §0).
 */
import type { Evaluation, MeshData } from '../types'

export interface GlbOptions {
  /** Include stones. Default true. */
  stones?: boolean
  /** Written to `asset.generator`. */
  generator?: string
}

const FLOAT = 5126
const UINT32 = 5125
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963
const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

/** Z-up mm → Y-up m: (x, y, z) ↦ (x, z, −y) / 1000, column-major. */
const ROOT_MATRIX = [0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0, 0, 0, 1]

interface Accessor {
  bufferView: number
  componentType: number
  count: number
  type: 'SCALAR' | 'VEC3'
  min?: number[]
  max?: number[]
}

class BinaryBuilder {
  readonly views: { buffer: 0; byteOffset: number; byteLength: number; target: number }[] = []
  readonly accessors: Accessor[] = []
  private chunks: Uint8Array[] = []
  private length = 0

  private view(data: Float32Array | Uint32Array, target: number): number {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    this.views.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength, target })
    this.chunks.push(bytes)
    this.length += bytes.byteLength // 4-byte components keep every view aligned
    return this.views.length - 1
  }

  vec3(data: Float32Array, withBounds: boolean): number {
    const accessor: Accessor = {
      bufferView: this.view(data, ARRAY_BUFFER),
      componentType: FLOAT,
      count: data.length / 3,
      type: 'VEC3',
    }
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity]
      const max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < data.length; i++) {
        const c = i % 3
        min[c] = Math.min(min[c]!, data[i]!)
        max[c] = Math.max(max[c]!, data[i]!)
      }
      Object.assign(accessor, { min, max })
    }
    this.accessors.push(accessor)
    return this.accessors.length - 1
  }

  indices(data: Uint32Array): number {
    this.accessors.push({
      bufferView: this.view(data, ELEMENT_ARRAY_BUFFER),
      componentType: UINT32,
      count: data.length,
      type: 'SCALAR',
    })
    return this.accessors.length - 1
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.length)
    let offset = 0
    for (const c of this.chunks) {
      out.set(c, offset)
      offset += c.byteLength
    }
    return out
  }
}

const pad4 = (n: number) => (n + 3) & ~3

export function writeGlb(evaluation: Evaluation, options: GlbOptions = {}): Uint8Array {
  const bin = new BinaryBuilder()
  const meshes: object[] = []
  const materials: { name: string; pbrMetallicRoughness: object }[] = []
  const materialIndex = new Map<string, number>()
  const nodes: object[] = [{ name: 'pave', matrix: ROOT_MATRIX, children: [] as number[] }]
  const children = (nodes[0] as { children: number[] }).children

  const material = (name: string, metal: boolean): number => {
    let index = materialIndex.get(name)
    if (index === undefined) {
      index = materials.length
      materials.push({
        name,
        pbrMetallicRoughness: metal
          ? { baseColorFactor: [0.9, 0.85, 0.75, 1], metallicFactor: 1, roughnessFactor: 0.15 }
          : { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0 },
      })
      materialIndex.set(name, index)
    }
    return index
  }

  const mesh = (name: string, data: MeshData, materialId: number): number => {
    meshes.push({
      name,
      primitives: [
        {
          attributes: { POSITION: bin.vec3(data.positions, true), NORMAL: bin.vec3(data.normals, false) },
          indices: bin.indices(data.indices),
          material: materialId,
        },
      ],
    })
    return meshes.length - 1
  }

  const node = (n: object) => {
    nodes.push(n)
    children.push(nodes.length - 1)
  }

  for (const part of evaluation.parts) {
    node({
      name: part.id,
      mesh: mesh(part.id, part.mesh, material(part.material, true)),
      extras: {
        nodeId: part.nodeId,
        role: 'metal',
        material: part.material,
        finish: part.finish,
        plating: part.plating,
      },
    })
  }

  if (options.stones ?? true) {
    const gemMesh = new Map<string, number>()
    for (const stone of evaluation.stones) {
      const key = `${stone.meshKey}|${stone.stone}`
      let meshId = gemMesh.get(key)
      if (meshId === undefined) {
        const data = evaluation.gemMeshes[stone.meshKey]
        if (!data) throw new Error(`Stone ${stone.id} references missing gem mesh "${stone.meshKey}"`)
        meshId = mesh(stone.meshKey, data, material(stone.stone, false))
        gemMesh.set(key, meshId)
      }
      node({
        name: stone.id,
        mesh: meshId,
        matrix: stone.matrix,
        extras: { nodeId: stone.nodeId, role: 'gem', stone: stone.stone, cut: stone.cut, carat: stone.carat },
      })
    }
  }

  const binary = bin.bytes()
  const json = {
    asset: { version: '2.0', generator: options.generator ?? 'Pavé kernel' },
    scene: 0,
    scenes: [{ name: 'pave', nodes: [0] }],
    nodes,
    meshes,
    materials,
    accessors: bin.accessors,
    bufferViews: bin.views,
    buffers: [{ byteLength: binary.byteLength }],
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonLength = pad4(jsonBytes.byteLength)
  const binLength = pad4(binary.byteLength)
  const total = 12 + 8 + jsonLength + 8 + binLength
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, GLB_MAGIC, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, jsonLength, true)
  dv.setUint32(16, CHUNK_JSON, true)
  out.set(jsonBytes, 20)
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLength) // JSON chunk pads with spaces
  const binStart = 20 + jsonLength
  dv.setUint32(binStart, binLength, true)
  dv.setUint32(binStart + 4, CHUNK_BIN, true)
  out.set(binary, binStart + 8)
  return out
}
