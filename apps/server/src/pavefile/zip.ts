/**
 * Reading and writing the zip container of a .pave file.
 *
 * Reading never trusts the file: the central directory is parsed here (not by a library that
 * unpacks everything at once), every name must pass `allowed` before anything is unpacked, the
 * sizes the directory declares are checked against the limits first, and each entry is inflated
 * in small chunks that stop the moment it grows past what it declared. So a zip bomb, a path like
 * `../../x` or a file that lies about its sizes is refused without filling memory. Nothing is
 * ever written to disk under a name from the file.
 */
import { Inflate, type Zippable, zipSync } from 'fflate'

export class ZipRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipRefused'
  }
}

export interface ZipLimits {
  fileBytes: number
  entries: number
  entryBytes: number
  totalBytes: number
}

interface Entry {
  name: string
  method: number
  compressedSize: number
  size: number
  dataStart: number
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
/** The end record is 22 bytes plus a comment of at most 65535. */
const EOCD_SEARCH = 22 + 0xffff
/** Inflate this much input at a time: a chunk can expand at most ~1000×, so overshoot is bounded. */
const CHUNK = 16 * 1024
/** Give the event loop a turn after this much input. */
const YIELD_EVERY = 1024 * 1024

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

function findEnd(view: DataView): number {
  const stop = Math.max(0, view.byteLength - EOCD_SEARCH)
  for (let i = view.byteLength - 22; i >= stop; i--) if (view.getUint32(i, true) === EOCD) return i
  throw new ZipRefused('This is not a .pave file: it is not a zip archive')
}

/** Names as the bytes say; anything outside printable ASCII fails the name check anyway. */
const nameOf = (bytes: Uint8Array) => String.fromCharCode(...bytes)

function directory(bytes: Uint8Array, limits: ZipLimits, allowed: (name: string) => boolean) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findEnd(view)
  const disk = view.getUint16(end + 4, true)
  const cdDisk = view.getUint16(end + 6, true)
  const count = view.getUint16(end + 10, true)
  const cdSize = view.getUint32(end + 12, true)
  const cdOffset = view.getUint32(end + 16, true)
  if (disk !== 0 || cdDisk !== 0) throw new ZipRefused('Split zip archives are not .pave files')
  // ZIP64 marks its fields with all-ones; a .pave never needs it (the limits are far below 4 GB).
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff)
    throw new ZipRefused('This file uses ZIP64, which .pave files never need')
  if (count > limits.entries)
    throw new ZipRefused(
      `The file holds ${count} entries; a .pave file holds at most ${limits.entries}`,
    )
  if (cdOffset + cdSize > end) throw new ZipRefused('The zip directory is damaged')

  const entries: Entry[] = []
  const seen = new Set<string>()
  let total = 0
  let at = cdOffset
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL)
      throw new ZipRefused('The zip directory is damaged')
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const compressedSize = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const localOffset = view.getUint32(at + 42, true)
    const name = nameOf(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength

    if (!allowed(name))
      throw new ZipRefused(
        `The file contains an entry named “${name.slice(0, 80)}”, which a .pave file never has`,
      )
    if (seen.has(name)) throw new ZipRefused(`The file contains “${name}” twice`)
    seen.add(name)
    if (flags & 1) throw new ZipRefused('Encrypted entries are not allowed in a .pave file')
    if (method !== 0 && method !== 8)
      throw new ZipRefused(`“${name}” uses a compression method .pave files do not use`)
    if (method === 0 && compressedSize !== size) throw new ZipRefused(`“${name}” is damaged`)
    if (size > limits.entryBytes)
      throw new ZipRefused(`“${name}” is too large (${size} bytes unpacked)`)
    total += size
    if (total > limits.totalBytes)
      throw new ZipRefused(`The file unpacks to more than ${limits.totalBytes} bytes`)

    // The local header repeats the name; its own lengths say where the data starts.
    if (localOffset + 30 > cdOffset || view.getUint32(localOffset, true) !== LOCAL)
      throw new ZipRefused(`“${name}” is damaged`)
    const localName = view.getUint16(localOffset + 26, true)
    const localExtra = view.getUint16(localOffset + 28, true)
    if (nameOf(bytes.subarray(localOffset + 30, localOffset + 30 + localName)) !== name)
      throw new ZipRefused(`“${name}” is damaged: its two names differ`)
    const dataStart = localOffset + 30 + localName + localExtra
    if (dataStart + compressedSize > cdOffset) throw new ZipRefused(`“${name}” is damaged`)
    entries.push({ name, method, compressedSize, size, dataStart })
  }
  return entries
}

/** Inflates one entry, refusing as soon as it grows past the size it declared. */
async function inflate(entry: Entry, data: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
  const out = new Uint8Array(entry.size)
  let written = 0
  const stream = new Inflate((chunk) => {
    if (written + chunk.length > entry.size)
      throw new ZipRefused(`“${entry.name}” unpacks to more than it declares`)
    out.set(chunk, written)
    written += chunk.length
  })
  try {
    let sinceYield = 0
    for (let i = 0; i < data.length; i += CHUNK) {
      const last = i + CHUNK >= data.length
      stream.push(data.subarray(i, i + CHUNK), last)
      sinceYield += CHUNK
      if (sinceYield >= YIELD_EVERY && !last) {
        sinceYield = 0
        await yieldToLoop()
        signal?.throwIfAborted()
      }
    }
    if (data.length === 0) stream.push(new Uint8Array(0), true)
  } catch (err) {
    if (err instanceof ZipRefused || (err instanceof DOMException && err.name === 'AbortError'))
      throw err
    throw new ZipRefused(`“${entry.name}” is damaged and cannot be unpacked`)
  }
  if (written !== entry.size) throw new ZipRefused(`“${entry.name}” is shorter than it declares`)
  return out
}

/**
 * Unpacks a zip into memory, by name. `allowed` decides every name before anything is
 * unpacked; any name it refuses refuses the whole file.
 */
export async function readZip(
  bytes: Uint8Array,
  limits: ZipLimits,
  allowed: (name: string) => boolean,
  signal?: AbortSignal,
): Promise<Map<string, Uint8Array>> {
  if (bytes.byteLength > limits.fileBytes)
    throw new ZipRefused(`The file is larger than ${limits.fileBytes} bytes`)
  const entries = directory(bytes, limits, allowed)
  const out = new Map<string, Uint8Array>()
  for (const entry of entries) {
    const data = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize)
    out.set(entry.name, entry.method === 0 ? data.slice() : await inflate(entry, data, signal))
  }
  return out
}

export interface ZipEntry {
  name: string
  bytes: Uint8Array
  /** Store without compression: the `mimetype` entry, and data that is compressed already. */
  store?: boolean
}

/** Writes entries in the order given (`mimetype` first, stored, so the file can be recognised). */
export function writeZip(entries: readonly ZipEntry[], date: Date): Uint8Array {
  // fflate writes DOS timestamps from local-time fields; build the Date from the UTC fields so
  // the bytes do not depend on the machine's time zone.
  const mtime = new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  )
  const files: Zippable = {}
  for (const e of entries) files[e.name] = [e.bytes, { level: e.store ? 0 : 6, mtime }]
  return zipSync(files)
}
