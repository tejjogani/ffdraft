import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { matrixStullerMaterial } from './matrix-stuller'

const uint = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const real = (n: number) => {
  const b = Buffer.alloc(8)
  b.writeDoubleLE(n)
  return b
}
const string = (s: string) => Buffer.concat([uint(s.length + 1), Buffer.from(`${s}\0`, 'utf16le')])
const chunk = (tag: number, data: Buffer) =>
  Buffer.concat([uint(tag), uint(data.length), uint(0), data])
const field = (key: string, value: string | number) =>
  Buffer.concat([
    string(key),
    ...(typeof value === 'string' ? [uint(9), string(value)] : [uint(2), uint(value)]),
  ])

function attributes(type: 'Metal' | 'Gem', signature = true, enabled = true) {
  const fields = [
    field('MaterialType', type),
    field('StullerMaterial', +enabled),
    ...(type === 'Metal'
      ? [field('StullerMetal', 'TEST-14K')]
      : [field('StullerStoneFamily', 'Tourmaline'), field('StullerStoneColor', 'Green')]),
    Buffer.concat([string('SPECIFICGRAVITY'), uint(3), real(2.5)]),
  ]
  const header = Buffer.alloc(193)
  const cls = Buffer.from('f6ceeae657a9074e835f1a96b9c70e6f', 'hex')
  cls.copy(header)
  cls.copy(header, 16)
  if (signature) Buffer.from('91f6ae7f8ec62a46af89899bff11a80f', 'hex').copy(header, 164)
  header.writeUInt32LE(crc32(header.subarray(0, -4)), header.length - 4)
  const dict = chunk(
    0x40008000,
    Buffer.concat([uint(1), Buffer.alloc(20), uint(fields.length), ...fields, uint(0)]),
  )
  dict.writeUInt32LE(crc32(dict.subarray(12, -4)), dict.length - 4)
  const data = Buffer.concat([
    Buffer.from([0x22]),
    chunk(0x2fff9, header),
    chunk(0x40008000, Buffer.concat([dict, uint(0)])),
  ])
  return chunk(0x27ffa, Buffer.concat([chunk(0x27ffd, data), chunk(0x80027fff, Buffer.alloc(0))]))
}

describe('object-scoped Matrix supplier attributes', () => {
  it('reads only the enabled supplier fields of the material dictionary', () => {
    expect(matrixStullerMaterial(attributes('Metal'))).toEqual({ metal: 'TEST-14K' })
    expect(matrixStullerMaterial(attributes('Gem'))).toEqual({
      stoneFamily: 'Tourmaline',
      stoneColor: 'Green',
    })
  })
  it('rejects an unrelated plugin, a disabled supplier, text lookalikes and broken bounds', () => {
    const data = attributes('Metal')
    expect(matrixStullerMaterial(attributes('Metal', false))).toBeUndefined()
    expect(matrixStullerMaterial(attributes('Metal', true, false))).toBeUndefined()
    expect(matrixStullerMaterial(Buffer.concat([Buffer.alloc(50), data]))).toBeUndefined()
    expect(matrixStullerMaterial(data.subarray(0, data.length - 1))).toBeUndefined()
    const bad = Buffer.from(data)
    bad.writeUInt32LE(0x7fffffff, bad.indexOf(Buffer.from('TEST-14K', 'utf16le')) - 4)
    expect(matrixStullerMaterial(bad)).toBeUndefined()
  })
})
