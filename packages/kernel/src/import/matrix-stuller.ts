import { RhinoStullerMaterial } from '@pave/schema'
import type { ObjectAttributes } from 'rhino3dm'

// Matrix 9 attaches these fields to ON_3dmObjectAttributes as custom userdata. rhino3dm
// exposes the serialized object but does not register the Matrix plug-in's userdata class.
const MATRIX_MATERIAL_CLASS = [
  0xf6, 0xce, 0xea, 0xe6, 0x57, 0xa9, 0x07, 0x4e, 0x83, 0x5f, 0x1a, 0x96, 0xb9, 0xc7, 0x0e, 0x6f,
]
const MATRIX_PLUGIN = [
  0x91, 0xf6, 0xae, 0x7f, 0x8e, 0xc6, 0x2a, 0x46, 0xaf, 0x89, 0x89, 0x9b, 0xff, 0x11, 0xa8, 0x0f,
]
const OPENNURBS_CLASS = 0x27ffa
const CLASS_USERDATA = 0x27ffd
const USERDATA_HEADER = 0x2fff9
const CLASS_END = 0x80027fff
const ANONYMOUS_CHUNK = 0x40008000
const decoder = new TextDecoder('utf-16le', { fatal: true })
export const PAVE_STULLER_FIELD = 'paveSourceStullerMaterial'

function chunk(data: Uint8Array, offset: number) {
  if (offset + 12 > data.length) return
  const view = new DataView(data.buffer, data.byteOffset + offset, 12)
  const tag = view.getUint32(0, true)
  const end = offset + 12 + view.getUint32(4, true)
  if (view.getUint32(8, true) !== 0 || end > data.length) return
  return { tag, end, content: data.subarray(offset + 12, end) }
}

function validChecksum(data: Uint8Array) {
  let crc = -1
  for (const byte of data.subarray(0, -4)) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  const stored = new DataView(data.buffer, data.byteOffset + data.length - 4, 4)
  return stored.getUint32(0, true) === ~crc >>> 0
}

function dictionary(data: Uint8Array): RhinoStullerMaterial | undefined {
  // This Matrix version writes a version word, five reserved words, a field count,
  // then typed key/value pairs. Unknown versions and types cannot be skipped reliably.
  if (data.length < 32 || !validChecksum(data)) return
  const view = new DataView(data.buffer, data.byteOffset, data.length - 4)
  if (view.getUint32(0, true) !== 1 || data.subarray(4, 24).some(Boolean)) return
  const count = view.getUint32(24, true)
  if (count > 64) return
  let at = 28
  const word = () => {
    const value = view.getUint32(at, true)
    at += 4
    return value
  }
  const string = () => {
    const length = word()
    if (!length) return ''
    const end = at + 2 * length
    if (length > 256 || end > view.byteLength || view.getUint16(end - 2, true) !== 0)
      throw RangeError()
    const value = decoder.decode(data.subarray(at, end - 2))
    at = end
    return value
  }
  const fields = new Map<string, string | number>()
  try {
    for (let i = 0; i < count; i++) {
      const name = string()
      if (fields.has(name)) return
      switch (word()) {
        case 9:
          fields.set(name, string())
          break
        case 2:
          fields.set(name, word())
          break
        case 3:
          fields.set(name, view.getFloat64(at, true))
          at += 8
          break
        default:
          return
      }
    }
  } catch {
    return
  }
  if (at !== view.byteLength || fields.get('StullerMaterial') !== 1) return
  const type = fields.get('MaterialType')
  const value =
    type === 'Metal'
      ? { metal: fields.get('StullerMetal') }
      : type === 'Gem'
        ? {
            stoneFamily: fields.get('StullerStoneFamily'),
            stoneColor: fields.get('StullerStoneColor') || undefined,
          }
        : undefined
  return RhinoStullerMaterial.safeParse(value).data
}

export function matrixStullerMaterial(data: Uint8Array): RhinoStullerMaterial | undefined {
  const root = chunk(data, 0)
  if (root?.tag !== OPENNURBS_CLASS || root.end !== data.length) return
  let found: RhinoStullerMaterial | undefined
  for (let i = 0; i < root.content.length; ) {
    const item = chunk(root.content, i)
    if (!item) return
    i = item.end
    if (item.tag === CLASS_END)
      return i === root.content.length && !item.content.length ? found : undefined
    if (item.tag !== CLASS_USERDATA || item.content[0] !== 0x22) continue
    const header = chunk(item.content, 1)
    if (header?.tag !== USERDATA_HEADER || header.content.length !== 193) continue
    if (
      !MATRIX_MATERIAL_CLASS.every(
        (v, j) => header.content[j] === v && header.content[16 + j] === v,
      ) ||
      !MATRIX_PLUGIN.every((v, j) => header.content[164 + j] === v) ||
      !validChecksum(header.content)
    )
      continue
    const outer = chunk(item.content, header.end)
    if (outer?.tag !== ANONYMOUS_CHUNK || outer.end !== item.content.length) return
    const inner = chunk(outer.content, 0)
    if (inner?.tag !== ANONYMOUS_CHUNK || inner.end + 4 !== outer.content.length || found) return
    found = dictionary(inner.content)
    if (!found) return
  }
  return undefined
}

export function readStullerMaterial(attrs: ObjectAttributes | undefined) {
  if (!attrs) return
  try {
    const saved = attrs.getUserString(PAVE_STULLER_FIELD)
    if (saved) return RhinoStullerMaterial.safeParse(JSON.parse(saved)).data
    const record = attrs.encode() as unknown as { data?: string }
    if (!record.data || record.data.length > 512 * 1024) return
    return matrixStullerMaterial(Uint8Array.from(atob(record.data), (char) => char.charCodeAt(0)))
  } catch {
    // An unavailable optional supplier label does not prevent geometry import.
    return undefined
  }
}
