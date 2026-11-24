/**
 * 3MF: a ZIP package whose model part lists objects (meshes or components of other objects) and
 * build items with affine transforms. Parsed with a small tag scanner — DOMParser does not
 * exist in Workers.
 */
import { unzipSync } from 'fflate'
import { IDENTITY, type Mat4, multiply } from '../../geometry/vec'
import { type IndexedTriangles, isMirror } from '../../solid/meshing'
import { decodeText } from './text'

export const isZip = (bytes: Uint8Array): boolean =>
  bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4

interface MeshObject {
  vertices: number[]
  triangles: number[]
  components: { id: string; transform: Mat4 }[]
}

const TAG = /<(\/?)([\w:]+)((?:\s+[\w:]+\s*=\s*"[^"]*")*)\s*(\/?)>/g
const ATTR = /([\w:]+)\s*=\s*"([^"]*)"/g

function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (let m = ATTR.exec(text); m; m = ATTR.exec(text)) out[m[1]!] = m[2]!
  ATTR.lastIndex = 0
  return out
}

/** 3MF "m00 m01 m02 m10 … m32" (row vectors) → column-major Mat4. */
function parseTransform(value: string | undefined): Mat4 {
  if (!value) return IDENTITY
  const m = value.trim().split(/\s+/).map(Number)
  if (m.length !== 12 || m.some((v) => !Number.isFinite(v)))
    throw new Error('The 3MF file has a malformed transform')
  return [
    m[0]!,
    m[1]!,
    m[2]!,
    0,
    m[3]!,
    m[4]!,
    m[5]!,
    0,
    m[6]!,
    m[7]!,
    m[8]!,
    0,
    m[9]!,
    m[10]!,
    m[11]!,
    1,
  ]
}

export function parse3mf(bytes: Uint8Array): IndexedTriangles {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, { filter: (f) => f.name.toLowerCase().endsWith('.model') })
  } catch {
    throw new Error('The 3MF file is not a readable ZIP package')
  }
  // The root model is conventionally 3D/3dmodel.model; take any model part otherwise.
  const names = Object.keys(files).sort()
  const root = names.find((n) => n.toLowerCase() === '3d/3dmodel.model') ?? names[0]
  if (!root) throw new Error('The 3MF package has no 3D model part')
  const xml = decodeText(files[root]!)

  const objects = new Map<string, MeshObject>()
  const items: { id: string; transform: Mat4 }[] = []
  let current: MeshObject | null = null
  for (let m = TAG.exec(xml); m; m = TAG.exec(xml)) {
    const [, closing, rawName, attrText] = m
    const name = rawName!.replace(/^.*:/, '')
    if (closing) {
      if (name === 'object') current = null
      continue
    }
    const a = attributes(attrText ?? '')
    if (name === 'object') {
      current = { vertices: [], triangles: [], components: [] }
      objects.set(a.id ?? '', current)
    } else if (name === 'vertex' && current)
      current.vertices.push(Number(a.x), Number(a.y), Number(a.z))
    else if (name === 'triangle' && current)
      current.triangles.push(Number(a.v1), Number(a.v2), Number(a.v3))
    else if (name === 'component' && current)
      current.components.push({ id: a.objectid ?? '', transform: parseTransform(a.transform) })
    else if (name === 'item')
      items.push({ id: a.objectid ?? '', transform: parseTransform(a.transform) })
  }
  TAG.lastIndex = 0

  const positions: number[] = []
  const indices: number[] = []
  const emit = (id: string, matrix: Mat4, depth: number) => {
    const object = objects.get(id)
    if (!object || depth > 32) return
    const base = positions.length / 3
    const v = object.vertices
    for (let i = 0; i < v.length; i += 3)
      positions.push(
        matrix[0]! * v[i]! + matrix[4]! * v[i + 1]! + matrix[8]! * v[i + 2]! + matrix[12]!,
        matrix[1]! * v[i]! + matrix[5]! * v[i + 1]! + matrix[9]! * v[i + 2]! + matrix[13]!,
        matrix[2]! * v[i]! + matrix[6]! * v[i + 1]! + matrix[10]! * v[i + 2]! + matrix[14]!,
      )
    const flip = isMirror(matrix)
    const count = v.length / 3
    for (let i = 0; i < object.triangles.length; i += 3) {
      const [a, b, c] = [object.triangles[i]!, object.triangles[i + 1]!, object.triangles[i + 2]!]
      if (![a, b, c].every((x) => Number.isInteger(x) && x >= 0 && x < count))
        throw new Error('The 3MF file has a triangle that refers to a missing vertex')
      indices.push(base + a, base + (flip ? c : b), base + (flip ? b : c))
    }
    for (const component of object.components)
      emit(component.id, multiply(matrix, component.transform), depth + 1)
  }
  const build =
    items.length > 0 ? items : [...objects.keys()].map((id) => ({ id, transform: IDENTITY }))
  for (const item of build) emit(item.id, item.transform, 0)
  if (indices.length === 0) throw new Error('The 3MF file contains no triangle meshes')
  if (positions.some((x) => !Number.isFinite(x)))
    throw new Error('The 3MF file has non-numeric vertex coordinates')
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
