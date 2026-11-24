/**
 * Pair kerning from a font's GPOS table, for the lookups opentype.js leaves out.
 *
 * Inter and Playfair Display keep their kerning in GPOS pair-adjustment lookups wrapped in
 * Extension lookups (type 9), which opentype.js does not parse: `getKerningValue` returns 0 for
 * every pair and "AV" or "To" are set wide apart. This reads exactly that part of the table —
 * the `kern` feature's pair adjustments, direct or through Extension lookups, formats 1 and 2 —
 * from the font file's bytes (sfnt or WOFF). OpenType spec: GPOS lookup types 2 and 9.
 */
import { unzlibSync } from 'fflate'

/** Horizontal advance adjustment between two glyph ids, in font units. */
export type PairKerning = (left: number, right: number) => number

const tag = (v: DataView, at: number) =>
  String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3))

/** The GPOS table's bytes, or null when the font has none. */
function gposBytes(bytes: Uint8Array): DataView | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const woff = tag(v, 0) === 'wOFF'
  const count = v.getUint16(woff ? 12 : 4)
  for (let i = 0; i < count; i++) {
    const entry = woff ? 44 + i * 20 : 12 + i * 16
    if (tag(v, entry) !== 'GPOS') continue
    const offset = v.getUint32(entry + (woff ? 4 : 8))
    const length = v.getUint32(entry + (woff ? 8 : 12))
    let table = bytes.subarray(offset, offset + length)
    // WOFF tables are zlib-compressed unless that would not have saved anything.
    if (woff && length < v.getUint32(entry + 12)) table = unzlibSync(table)
    return new DataView(table.buffer, table.byteOffset, table.byteLength)
  }
  return null
}

/** Coverage index of a glyph, or −1. */
function coverage(v: DataView, at: number, glyph: number): number {
  const format = v.getUint16(at)
  const count = v.getUint16(at + 2)
  for (let i = 0; i < count; i++) {
    if (format === 1) {
      if (v.getUint16(at + 4 + i * 2) === glyph) return i
    } else {
      const r = at + 4 + i * 6
      const start = v.getUint16(r)
      if (glyph >= start && glyph <= v.getUint16(r + 2)) return v.getUint16(r + 4) + glyph - start
    }
  }
  return -1
}

/** Class of a glyph in a class definition table (0 when unlisted). */
function classOf(v: DataView, at: number, glyph: number): number {
  const format = v.getUint16(at)
  if (format === 1) {
    const start = v.getUint16(at + 2)
    const count = v.getUint16(at + 4)
    return glyph >= start && glyph < start + count ? v.getUint16(at + 6 + (glyph - start) * 2) : 0
  }
  const ranges = v.getUint16(at + 2)
  for (let i = 0; i < ranges; i++) {
    const r = at + 4 + i * 6
    if (glyph >= v.getUint16(r) && glyph <= v.getUint16(r + 2)) return v.getUint16(r + 4)
  }
  return 0
}

/** Bytes in a value record of this format: two per field present. */
const valueSize = (format: number): number => {
  let bits = 0
  for (let f = format; f; f >>= 1) bits += f & 1
  return 2 * bits
}
/** Byte offset of XAdvance in a value record, or −1 when the format has none. */
const xAdvanceAt = (format: number): number =>
  format & 4 ? 2 * ((format & 1) + ((format >> 1) & 1)) : -1

/**
 * The adjustment a pair-adjustment subtable at `at` gives (left, right), or null when the
 * subtable does not cover the pair (the next subtable is then asked).
 */
function pairValue(v: DataView, at: number, left: number, right: number): number | null {
  const format = v.getUint16(at)
  const index = coverage(v, at + v.getUint16(at + 2), left)
  if (index < 0) return null
  const format1 = v.getUint16(at + 4)
  const size = valueSize(format1) + valueSize(v.getUint16(at + 6))
  const x = xAdvanceAt(format1)
  if (format === 1) {
    const set = at + v.getUint16(at + 10 + index * 2)
    const pairs = v.getUint16(set)
    for (let i = 0; i < pairs; i++) {
      const record = set + 2 + i * (2 + size)
      if (v.getUint16(record) === right) return x < 0 ? 0 : v.getInt16(record + 2 + x)
    }
    return null
  }
  const class1 = classOf(v, at + v.getUint16(at + 8), left)
  const class2 = classOf(v, at + v.getUint16(at + 10), right)
  const class2Count = v.getUint16(at + 14)
  const record = at + 16 + (class1 * class2Count + class2) * size
  return x < 0 ? 0 : v.getInt16(record + x)
}

/** The `kern` feature's pair-adjustment subtables, Extension lookups unwrapped. */
function kernSubtables(v: DataView): number[] {
  // Header: version (4 bytes), then the script, feature and lookup list offsets.
  const features = v.getUint16(6)
  const lookups = v.getUint16(8)
  const indices = new Set<number>()
  const featureCount = v.getUint16(features)
  for (let i = 0; i < featureCount; i++) {
    const record = features + 2 + i * 6
    if (tag(v, record) !== 'kern') continue
    const feature = features + v.getUint16(record + 4)
    const n = v.getUint16(feature + 2)
    for (let k = 0; k < n; k++) indices.add(v.getUint16(feature + 4 + k * 2))
  }
  const subtables: number[] = []
  for (const index of [...indices].sort((a, b) => a - b)) {
    const lookup = lookups + v.getUint16(lookups + 2 + index * 2)
    const type = v.getUint16(lookup)
    const n = v.getUint16(lookup + 4)
    for (let k = 0; k < n; k++) {
      const sub = lookup + v.getUint16(lookup + 6 + k * 2)
      if (type === 2) subtables.push(sub)
      else if (type === 9 && v.getUint16(sub + 2) === 2) subtables.push(sub + v.getUint32(sub + 4))
    }
  }
  return subtables
}

/** Reads the font's GPOS pair kerning, or null when it has none. */
export function gposKerning(bytes: Uint8Array): PairKerning | null {
  const v = gposBytes(bytes)
  if (!v) return null
  const subtables = kernSubtables(v)
  if (subtables.length === 0) return null
  const memo = new Map<number, number>()
  return (left, right) => {
    const key = left * 65536 + right
    let value = memo.get(key)
    if (value === undefined) {
      value = 0
      for (const sub of subtables) {
        const found = pairValue(v, sub, left, right)
        if (found !== null) {
          value = found
          break
        }
      }
      memo.set(key, value)
    }
    return value
  }
}
