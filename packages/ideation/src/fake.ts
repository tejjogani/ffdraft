/**
 * The test provider: deterministic pictures, no key, no network. Each image is a small PNG of a
 * gold ring with a stone on a plain ground, its colours varied by the image number and the prompt,
 * so four images are visibly four and the same request draws the same pictures.
 *
 * Markers in a prompt script the provider's side of a test: `[fake:block 2]` has its own filter
 * withhold image 2, `[fake:fail]` fails the request. Every call is kept in `calls`, so a test can
 * see the prompt, references and settings the pipeline sent.
 */
import { deflateSync } from 'node:zlib'
import type { GenerateCall, GenerateResult, ImageProvider } from './types'
import { ProviderError } from './types'

export const FAKE_PER_IMAGE_USD = 0.01

export interface FakeProvider extends ImageProvider {
  readonly calls: GenerateCall[]
}

export function fakeProvider(
  o: {
    size?: number
    /** Pictures to hand out in turn instead of drawn rings (screenshots, demos); PNG or JPEG bytes. */
    pictures?: { bytes: Uint8Array; mime: string }[]
  } = {},
): FakeProvider {
  let next = 0
  const size = o.size ?? 256
  const calls: GenerateCall[] = []
  return {
    id: 'fake',
    label: 'Test images',
    keyHelp: 'The test provider needs no key.',
    envNames: [],
    models: [{ id: 'fake-image-1', label: 'Test images', takesReferences: true }],
    defaultModel: 'fake-image-1',
    priceNote: 'A made-up price for tests.',
    seconds: 1,
    calls,
    perImageUsd: () => FAKE_PER_IMAGE_USD,
    async check() {
      return { ok: true, message: 'The test provider needs no key.' }
    },
    async generate(call): Promise<GenerateResult> {
      calls.push(call)
      if (call.signal?.aborted) throw call.signal.reason
      if (call.prompt.includes('[fake:fail]'))
        throw new ProviderError('error', 'The test provider was told to fail.', 500)
      const blockedIdx = new Set(
        [...call.prompt.matchAll(/\[fake:block (\d+)\]/g)].map((m) => Number(m[1])),
      )
      const seed = hash(`${call.prompt}|${call.seed ?? 0}`)
      const images = []
      const blocked = []
      for (let i = 1; i <= call.count; i++) {
        if (blockedIdx.has(i)) {
          blocked.push({ index: i, reason: 'The test provider’s filter withheld this image.' })
          continue
        }
        const picture = o.pictures?.length ? o.pictures[next++ % o.pictures.length]! : null
        images.push({
          index: i,
          bytes: picture?.bytes ?? ringPng(size, (seed + i * 97) % 360),
          mime: picture?.mime ?? 'image/png',
          costUsd: FAKE_PER_IMAGE_USD,
        })
      }
      return {
        model: call.model,
        images,
        blocked,
        costUsd: images.length * FAKE_PER_IMAGE_USD,
        estimated: true,
        notes: [],
      }
    },
  }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) % 100000
}

/** A ring seen from the front: a gold band, a coloured stone on top, a pale ground. */
export function ringPng(size: number, hue: number): Uint8Array<ArrayBuffer> {
  const rgba = new Uint8Array(size * size * 4)
  const c = size / 2
  const outer = size * 0.32
  const inner = size * 0.25
  const stone = { x: c, y: c - outer, r: size * 0.09 }
  const [sr, sg, sb] = hsl(hue, 0.6, 0.6)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      const d = Math.hypot(x - c, y - c)
      const ds = Math.hypot(x - stone.x, y - stone.y)
      let px: [number, number, number] = [246, 244, 240]
      if (d <= outer && d >= inner) px = [212, 175, 55]
      if (ds <= stone.r) px = [sr, sg, sb]
      rgba[o] = px[0]
      rgba[o + 1] = px[1]
      rgba[o + 2] = px[2]
      rgba[o + 3] = 255
    }
  return encodePng(rgba, size, size)
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/**
 * A minimal RGBA PNG (8-bit, no filtering), enough for tests and for sharp to read. Backed by a
 * plain ArrayBuffer, so it can be a fetch Response body as it is.
 */
export function encodePng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const raw = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
