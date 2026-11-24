/** STL, binary and ASCII. Triangles come unwelded; normals in the file are ignored. */
import type { IndexedTriangles } from '../../solid/meshing'
import { decodeText } from './text'

const HEADER = 84
const RECORD = 50

/** Binary STL size is fully determined by its triangle count. */
export function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER) return false
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
  return HEADER + count * RECORD === bytes.length
}

/**
 * A binary STL cut short (an interrupted download or copy): the header promises more triangles
 * than the file holds. Only asked once no format matched, so text files never get here.
 */
export function truncatedStl(bytes: Uint8Array): { promised: number; present: number } | null {
  if (bytes.length < HEADER + RECORD) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(80, true)
  const present = Math.floor((bytes.length - HEADER) / RECORD)
  if (count <= present) return null
  // Any file has some number at byte 80; an STL's first record is a unit (or zero) normal and
  // three finite vertices.
  const f = (k: number) => view.getFloat32(HEADER + k * 4, true)
  const normal = Math.hypot(f(0), f(1), f(2))
  const sane = Array.from({ length: 12 }, (_, k) => f(k)).every(
    (v) => Number.isFinite(v) && Math.abs(v) < 1e7,
  )
  return sane && (normal < 1e-6 || Math.abs(normal - 1) < 1e-2)
    ? { promised: count, present }
    : null
}

export function looksLikeAsciiStl(head: string): boolean {
  return /^\s*solid\b/.test(head) && /\bfacet\b/.test(head)
}

export function parseStl(bytes: Uint8Array): IndexedTriangles {
  return isBinaryStl(bytes) ? parseBinary(bytes) : parseAscii(decodeText(bytes))
}

function sequential(positions: Float32Array): IndexedTriangles {
  const indices = new Uint32Array(positions.length / 3)
  for (let i = 0; i < indices.length; i++) indices[i] = i
  return { positions, indices }
}

function parseBinary(bytes: Uint8Array): IndexedTriangles {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(80, true)
  const positions = new Float32Array(count * 9)
  for (let t = 0; t < count; t++) {
    const base = HEADER + t * RECORD + 12
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(base + k * 4, true)
  }
  return sequential(positions)
}

function parseAscii(text: string): IndexedTriangles {
  const values: number[] = []
  const vertex = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g
  for (let m = vertex.exec(text); m; m = vertex.exec(text))
    values.push(Number(m[1]), Number(m[2]), Number(m[3]))
  if (values.length % 9 !== 0 || values.some((v) => !Number.isFinite(v)))
    throw new Error(
      'The ASCII STL file is malformed (a facet does not have three numeric vertices)',
    )
  return sequential(Float32Array.from(values))
}
