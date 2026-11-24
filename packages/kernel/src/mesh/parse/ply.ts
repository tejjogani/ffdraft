/**
 * Stanford PLY (ascii, binary little- and big-endian) — the usual format of scanners. Reads the
 * vertex x/y/z and face index lists; every other element and property is skipped.
 */
import type { IndexedTriangles } from '../../solid/meshing'
import { decodeText, fan } from './text'

type Scalar = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64'

const TYPES: Record<string, Scalar> = {
  char: 'i8', int8: 'i8', uchar: 'u8', uint8: 'u8',
  short: 'i16', int16: 'i16', ushort: 'u16', uint16: 'u16',
  int: 'i32', int32: 'i32', uint: 'u32', uint32: 'u32',
  float: 'f32', float32: 'f32', double: 'f64', float64: 'f64',
} // biome-ignore format: lookup table

const SIZE: Record<Scalar, number> = {
  i8: 1,
  u8: 1,
  i16: 2,
  u16: 2,
  i32: 4,
  u32: 4,
  f32: 4,
  f64: 8,
}

interface Property {
  name: string
  type: Scalar
  /** Set for list properties: the type of the length prefix. */
  countType?: Scalar
}

interface Element {
  name: string
  count: number
  properties: Property[]
}

export const looksLikePly = (head: string): boolean => /^ply\r?\n/.test(head)

function scalarType(name: string | undefined): Scalar {
  const t = name && TYPES[name]
  if (!t) throw new Error(`The PLY file uses an unknown property type “${name}”`)
  return t
}

export function parsePly(bytes: Uint8Array): IndexedTriangles {
  const headerEnd = findHeaderEnd(bytes)
  const header = decodeText(bytes.subarray(0, headerEnd)).split(/\r?\n/)
  let format = ''
  const elements: Element[] = []
  for (const line of header) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] === 'format') format = parts[1] ?? ''
    else if (parts[0] === 'element')
      elements.push({ name: parts[1]!, count: Number(parts[2]), properties: [] })
    else if (parts[0] === 'property') {
      const element = elements.at(-1)
      if (!element) throw new Error('The PLY header declares a property outside an element')
      if (parts[1] === 'list')
        element.properties.push({
          name: parts[4]!,
          type: scalarType(parts[3]),
          countType: scalarType(parts[2]),
        })
      else element.properties.push({ name: parts[2]!, type: scalarType(parts[1]) })
    }
  }
  const body = bytes.subarray(headerEnd)
  const reader =
    format === 'ascii'
      ? asciiReader(decodeText(body))
      : format === 'binary_little_endian' || format === 'binary_big_endian'
        ? binaryReader(body, format === 'binary_little_endian')
        : null
  if (!reader) throw new Error(`The PLY format “${format}” is not supported`)

  const positions: number[] = []
  const indices: number[] = []
  const polygon: number[] = []
  for (const element of elements) {
    const props = element.properties
    const xyz = ['x', 'y', 'z'].map((n) => props.findIndex((p) => p.name === n))
    const faceList = props.findIndex(
      (p) => p.countType && (p.name === 'vertex_indices' || p.name === 'vertex_index'),
    )
    for (let e = 0; e < element.count; e++) {
      const values: number[] = []
      polygon.length = 0
      props.forEach((p, i) => {
        if (p.countType) {
          const n = reader(p.countType)
          for (let k = 0; k < n; k++) {
            const v = reader(p.type)
            if (i === faceList) polygon.push(v)
          }
        } else values[i] = reader(p.type)
      })
      if (element.name === 'vertex') {
        if (xyz.some((i) => i < 0)) throw new Error('The PLY vertices have no x, y, z properties')
        positions.push(values[xyz[0]!]!, values[xyz[1]!]!, values[xyz[2]!]!)
      } else if (element.name === 'face' && faceList >= 0) fan(polygon, indices)
    }
  }
  const vertexCount = positions.length / 3
  if (indices.some((i) => i < 0 || i >= vertexCount))
    throw new Error('The PLY faces refer to missing vertices')
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

function findHeaderEnd(bytes: Uint8Array): number {
  const marker = 'end_header'
  const limit = Math.min(bytes.length, 64 * 1024)
  for (let i = 0; i < limit - marker.length; i++) {
    let match = true
    for (let k = 0; k < marker.length && match; k++) match = bytes[i + k] === marker.charCodeAt(k)
    if (!match) continue
    let end = i + marker.length
    if (bytes[end] === 13) end++
    if (bytes[end] === 10) end++
    return end
  }
  throw new Error('The PLY file has no end_header line')
}

type Reader = (type: Scalar) => number

function asciiReader(text: string): Reader {
  const tokens = text.split(/\s+/).filter(Boolean)
  let at = 0
  return () => {
    if (at >= tokens.length) throw new Error('The PLY file ends early')
    return Number(tokens[at++])
  }
}

function binaryReader(body: Uint8Array, little: boolean): Reader {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  let at = 0
  return (type) => {
    if (at + SIZE[type] > body.length) throw new Error('The PLY file ends early')
    let v: number
    switch (type) {
      case 'i8': v = view.getInt8(at); break
      case 'u8': v = view.getUint8(at); break
      case 'i16': v = view.getInt16(at, little); break
      case 'u16': v = view.getUint16(at, little); break
      case 'i32': v = view.getInt32(at, little); break
      case 'u32': v = view.getUint32(at, little); break
      case 'f32': v = view.getFloat32(at, little); break
      case 'f64': v = view.getFloat64(at, little); break
    } // biome-ignore format: one case per line
    at += SIZE[type]
    return v
  }
}
