/**
 * Binary glTF 2.0 (.glb) — what image-to-3D services deliver. Walks the default scene with node
 * transforms, reads triangle primitives (lists, strips, fans; float or normalised-integer
 * positions) and converts glTF's Y-up, +Z-forward space to the kernel's Z-up, −Y-forward space.
 */
import { IDENTITY, type Mat4, multiply } from '../../geometry/vec'
import { type IndexedTriangles, isMirror } from '../../solid/meshing'
import { decodeText } from './text'

const MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

interface Accessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  normalized?: boolean
  count: number
  type: string
}
interface BufferView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
}
interface Primitive {
  attributes: Record<string, number>
  indices?: number
  mode?: number
  extensions?: Record<string, unknown>
}
interface GltfNode {
  children?: number[]
  mesh?: number
  matrix?: number[]
  translation?: [number, number, number]
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
}
interface Gltf {
  scene?: number
  scenes?: { nodes?: number[] }[]
  nodes?: GltfNode[]
  meshes?: { primitives: Primitive[] }[]
  accessors?: Accessor[]
  bufferViews?: BufferView[]
  extensionsRequired?: string[]
}

export const isGlb = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === MAGIC

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
/** Most numbers one accessor may hold (1 GB of doubles): far past any mesh this kernel can use. */
const MAX_VALUES = 2 ** 27
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }

export function parseGlb(bytes: Uint8Array): IndexedTriangles {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let json: Gltf | null = null
  let bin: Uint8Array | null = null
  for (let at = 12; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at, true)
    const type = view.getUint32(at + 4, true)
    if (at + 8 + length > bytes.length)
      throw new Error('The GLB file ends early: export or download it again.')
    const data = bytes.subarray(at + 8, at + 8 + length)
    if (type === CHUNK_JSON) json = JSON.parse(decodeText(data)) as Gltf
    else if (type === CHUNK_BIN && !bin) bin = data
    at += 8 + length
  }
  if (!json) throw new Error('The GLB file has no JSON chunk')
  const unsupported = (json.extensionsRequired ?? []).filter((e) => e !== 'KHR_mesh_quantization')
  if (unsupported.length > 0)
    throw new Error(
      `The GLB file needs ${unsupported.join(', ')} (compressed geometry). Re-export it without ` +
        'Draco/meshopt compression and import it again.',
    )
  const gltf = json
  const buffer = bin

  const read = (index: number): Float64Array => {
    const accessor = gltf.accessors?.[index]
    if (!accessor) throw new Error(`The GLB file refers to missing accessor ${index}`)
    const components = COMPONENTS[accessor.type] ?? 1
    const size = BYTES[accessor.componentType]
    if (!size)
      throw new Error(`The GLB file uses unsupported component type ${accessor.componentType}`)
    const { count } = accessor
    if (!Number.isInteger(count) || count < 0 || count * components > MAX_VALUES)
      throw new Error(`The GLB file has an accessor with an unusable count (${count})`)
    const out = new Float64Array(count * components)
    if (accessor.bufferView === undefined) return out // all zeros, per spec
    const bv = gltf.bufferViews?.[accessor.bufferView]
    if (bv?.buffer !== 0 || !buffer) throw new Error('The GLB file refers to an external buffer')
    const stride = bv.byteStride ?? size * components
    const start = (bv.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    // The data must lie inside the binary chunk. The chunk is a view into the caller's buffer
    // (a small upload shares Node's Buffer pool with other requests), so an offset past its end
    // would otherwise read whatever lies behind the file and return it as geometry.
    const end = count === 0 ? start : start + (count - 1) * stride + components * size
    if (!(start >= 0 && stride >= 0 && end <= buffer.byteLength))
      throw new Error(
        'The GLB file refers to data beyond its binary chunk: it is damaged or was cut short.',
      )
    const base = buffer.byteOffset + start
    const dv = new DataView(buffer.buffer)
    const scale = accessor.normalized ? normaliser(accessor.componentType) : 1
    for (let i = 0; i < accessor.count; i++)
      for (let c = 0; c < components; c++) {
        const at = base + i * stride + c * size
        out[i * components + c] = readComponent(dv, at, accessor.componentType) * scale
      }
    return out
  }

  const positions: number[] = []
  const indices: number[] = []
  const visit = (nodeIndex: number, parent: Mat4, depth: number) => {
    const node = gltf.nodes?.[nodeIndex]
    if (!node || depth > 64) return
    const matrix = multiply(parent, localMatrix(node))
    if (node.mesh !== undefined)
      for (const primitive of gltf.meshes?.[node.mesh]?.primitives ?? []) {
        if (primitive.extensions?.KHR_draco_mesh_compression)
          throw new Error('The GLB file is Draco-compressed. Re-export it without compression.')
        const mode = primitive.mode ?? 4
        if (mode < 4) continue // points and lines carry no surface
        const position = primitive.attributes.POSITION
        if (position === undefined) continue
        const p = read(position)
        const base = positions.length / 3
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i]!
          const y = p[i + 1]!
          const z = p[i + 2]!
          const wx = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!
          const wy = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!
          const wz = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!
          // glTF Y-up, front +Z  →  kernel Z-up, front −Y.
          positions.push(wx, -wz, wy)
        }
        const list =
          primitive.indices !== undefined
            ? Array.from(read(primitive.indices))
            : range(p.length / 3)
        const vertices = p.length / 3
        if (list.some((i) => !(i >= 0 && i < vertices)))
          throw new Error('The GLB file has a triangle that refers to a missing vertex')
        const flip = isMirror(matrix)
        for (const [a, b, c] of triangles(list, mode))
          indices.push(base + a, base + (flip ? c : b), base + (flip ? b : c))
      }
    for (const child of node.children ?? []) visit(child, matrix, depth + 1)
  }
  const scene = gltf.scenes?.[gltf.scene ?? 0]
  const roots = scene?.nodes ?? (gltf.nodes ?? []).map((_, i) => i)
  for (const root of roots) visit(root, IDENTITY, 0)
  if (indices.length === 0) throw new Error('The GLB file contains no triangle meshes')
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

function readComponent(dv: DataView, at: number, type: number): number {
  switch (type) {
    case 5120: return dv.getInt8(at)
    case 5121: return dv.getUint8(at)
    case 5122: return dv.getInt16(at, true)
    case 5123: return dv.getUint16(at, true)
    case 5125: return dv.getUint32(at, true)
    default: return dv.getFloat32(at, true)
  } // biome-ignore format: one case per line
}

function normaliser(type: number): number {
  return type === 5120
    ? 1 / 127
    : type === 5121
      ? 1 / 255
      : type === 5122
        ? 1 / 32767
        : type === 5123
          ? 1 / 65535
          : 1
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

function* triangles(list: readonly number[], mode: number): Generator<[number, number, number]> {
  if (mode === 4)
    for (let i = 0; i + 2 < list.length; i += 3) yield [list[i]!, list[i + 1]!, list[i + 2]!]
  else if (mode === 5)
    for (let i = 0; i + 2 < list.length; i++)
      yield i % 2 === 0
        ? [list[i]!, list[i + 1]!, list[i + 2]!]
        : [list[i + 1]!, list[i]!, list[i + 2]!]
  else if (mode === 6)
    for (let i = 1; i + 1 < list.length; i++) yield [list[0]!, list[i]!, list[i + 1]!]
}

function localMatrix(node: GltfNode): Mat4 {
  if (node.matrix?.length === 16) return node.matrix
  const t = node.translation ?? [0, 0, 0]
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  // Rotation matrix from a unit quaternion, columns scaled (glTF: M = T · R · S).
  const r = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw),
    2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw),
    2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ] // biome-ignore format: matrix layout
  return [
    r[0]! * sx, r[1]! * sx, r[2]! * sx, 0,
    r[3]! * sy, r[4]! * sy, r[5]! * sy, 0,
    r[6]! * sz, r[7]! * sz, r[8]! * sz, 0,
    t[0], t[1], t[2], 1,
  ] // biome-ignore format: matrix layout
}
