/**
 * The zip reader refuses what a crafted file could do to the server: names that are paths out
 * of nowhere (zip-slip), entries that unpack to more than the limits or than they declare (zip
 * bombs), too many entries, encrypted or exotic entries, and duplicate names. It decides from
 * the zip's own directory before unpacking anything.
 */
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readZip, writeZip, ZipRefused } from './zip'

const LIMITS = { fileBytes: 1 << 20, entries: 10, entryBytes: 64 * 1024, totalBytes: 128 * 1024 }
const anyName = () => true
const safeName = (n: string) => /^[a-z]+(\.[a-z]+)?$/.test(n)

const refused = (p: Promise<unknown>, message: RegExp) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof ZipRefused && message.test(e.message))

/** Rewrites every occurrence of one ASCII string in the bytes (same length), e.g. a name. */
function patch(bytes: Uint8Array, from: string, to: string): Uint8Array {
  expect(from.length).toBe(to.length)
  const out = bytes.slice()
  const f = strToU8(from)
  for (let i = 0; i + f.length <= out.length; i++)
    if (f.every((b, j) => out[i + j] === b)) out.set(strToU8(to), i)
  return out
}

describe('readZip', () => {
  it('reads what writeZip wrote, stored and deflated, in order', async () => {
    const bytes = writeZip(
      [
        { name: 'mimetype', bytes: strToU8('application/x'), store: true },
        { name: 'a.json', bytes: strToU8('{"a":1}'.repeat(100)) },
        { name: 'empty', bytes: new Uint8Array(0) },
      ],
      new Date('2026-11-25T10:00:00Z'),
    )
    const files = await readZip(bytes, LIMITS, anyName)
    expect([...files.keys()]).toEqual(['mimetype', 'a.json', 'empty'])
    expect(new TextDecoder().decode(files.get('a.json'))).toBe('{"a":1}'.repeat(100))
    expect(files.get('empty')!.length).toBe(0)
  })

  it('refuses names that are paths: parent folders, absolute, drive letters, backslashes', async () => {
    for (const name of ['../evil.json', '/etc/passwd', 'c:/x', 'a\\..\\b', 'dir/../../x'])
      await refused(
        readZip(zipSync({ ok: strToU8('1'), [name]: strToU8('x') }), LIMITS, safeName),
        /never has/,
      )
  })

  it('refuses a name that appears twice', async () => {
    const bytes = patch(zipSync({ first: strToU8('1'), secnd: strToU8('2') }), 'secnd', 'first')
    await refused(readZip(bytes, LIMITS, anyName), /twice/)
  })

  it('refuses entries over the size limits before unpacking them', async () => {
    const big = new Uint8Array(LIMITS.entryBytes + 1)
    await refused(readZip(zipSync({ big }), LIMITS, anyName), /too large/)
    const half = new Uint8Array(LIMITS.entryBytes)
    await refused(
      readZip(zipSync({ a: half, b: half, c: half }), LIMITS, anyName),
      /unpacks to more than/,
    )
    await refused(readZip(new Uint8Array(LIMITS.fileBytes + 1), LIMITS, anyName), /larger than/)
    const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`f${i}`, strToU8('x')]))
    await refused(readZip(zipSync(many), LIMITS, anyName), /holds at most 10/)
  })

  it('stops a zip bomb that lies about its size as soon as it grows past it', async () => {
    // 60 KB of zeros declares itself as 1 KB: the bytes in both size fields are patched.
    const honest = zipSync({ bomb: new Uint8Array(60_000) })
    const view = new DataView(honest.buffer)
    const cd = honest.length - 22 - 46 - 4 // the one central record: 46 bytes plus the name
    expect(view.getUint32(cd, true)).toBe(0x02014b50)
    view.setUint32(cd + 24, 1000, true)
    await refused(readZip(honest, LIMITS, anyName), /more than it declares/)
  })

  it('refuses what is not a zip, and encrypted entries', async () => {
    await refused(readZip(strToU8('just some text'), LIMITS, anyName), /not a zip/)
    const bytes = zipSync({ secret: strToU8('x') })
    const view = new DataView(bytes.buffer)
    const cd = bytes.length - 22 - 46 - 6
    view.setUint16(cd + 8, view.getUint16(cd + 8, true) | 1, true)
    await refused(readZip(bytes, LIMITS, anyName), /Encrypted/)
  })
})
