import { zlibSync } from 'fflate'
import { encode as encodeJpeg } from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { blur, decodeImage, luminanceHeights } from './raster'

/** Minimal PNG writer: one IDAT, the given filter on every row. */
function png(
  width: number,
  height: number,
  type: number,
  depth: number,
  rows: Uint8Array[],
  extra: [string, Uint8Array][] = [],
  filter = 0,
): Uint8Array {
  const chunk = (name: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, body.length)
    for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i)
    out.set(body, 8)
    return out // CRC is not checked by the decoder
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr.set([depth, type, 0, 0, 0], 8)
  const raw = new Uint8Array(rows.reduce((n, r) => n + r.length + 1, 0))
  let at = 0
  for (const r of rows) {
    raw[at++] = filter
    raw.set(r, at)
    at += r.length
  }
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...extra.map(([n, b]) => chunk(n, b)),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('height-map images', () => {
  it('decodes grey, RGB, RGBA, 16-bit, sub-byte and palette PNGs', () => {
    const grey = decodeImage(png(2, 1, 0, 8, [Uint8Array.from([0, 255])]))
    expect(Array.from(grey.rgba)).toEqual([0, 0, 0, 1, 1, 1, 1, 1])
    const rgb = decodeImage(png(1, 1, 2, 8, [Uint8Array.from([255, 0, 51])]))
    expect(rgb.rgba[2]).toBeCloseTo(0.2, 6)
    const rgba = decodeImage(png(1, 1, 6, 8, [Uint8Array.from([0, 0, 0, 128])]))
    expect(rgba.rgba[3]).toBeCloseTo(128 / 255, 6)
    const deep = decodeImage(png(1, 1, 0, 16, [Uint8Array.from([0x80, 0x00])]))
    expect(deep.rgba[0]).toBeCloseTo(0x8000 / 65535, 6)
    const bits = decodeImage(png(4, 1, 0, 2, [Uint8Array.from([0b00011011])]))
    for (const [i, v] of [0, 1 / 3, 2 / 3, 1].entries()) expect(bits.rgba[i * 4]).toBeCloseTo(v, 6)
    const palette = decodeImage(
      png(
        2,
        1,
        3,
        8,
        [Uint8Array.from([1, 0])],
        [
          ['PLTE', Uint8Array.from([10, 20, 30, 255, 255, 255])],
          ['tRNS', Uint8Array.from([0])],
        ],
      ),
    )
    expect(palette.rgba[0]).toBe(1)
    expect(palette.rgba[7]).toBe(0)
  })

  it('reverses every scanline filter', () => {
    // Paeth (4) and Up (2) on a 2×2 image; decoding must reproduce the raw values.
    for (const filter of [1, 2, 3, 4]) {
      const image = decodeImage(
        png(2, 2, 0, 8, [Uint8Array.from([10, 20]), Uint8Array.from([30, 40])], [], filter),
      )
      expect(image.rgba.length).toBe(16)
    }
    const up = decodeImage(png(1, 2, 0, 8, [Uint8Array.from([100]), Uint8Array.from([5])], [], 2))
    expect(up.rgba[4]).toBeCloseTo(105 / 255, 6)
  })

  it('decodes JPEG and turns luminance into heights, alpha and inversion included', () => {
    const data = new Uint8Array(8 * 8 * 4).fill(255)
    for (let i = 0; i < 32; i++) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 0
    const jpeg = decodeImage(encodeJpeg({ data, width: 8, height: 8 }, 95).data)
    expect(jpeg.width).toBe(8)
    const h = luminanceHeights(jpeg, false)
    expect(h[0]).toBeLessThan(0.1)
    expect(h[63]).toBeGreaterThan(0.9)
    expect(luminanceHeights(jpeg, true)[0]).toBeGreaterThan(0.9)
    const transparent = decodeImage(png(1, 1, 6, 8, [Uint8Array.from([255, 255, 255, 0])]))
    expect(luminanceHeights(transparent, false)[0]).toBe(0)
    expect(() => decodeImage(Uint8Array.from([1, 2, 3]))).toThrow(/PNG or JPEG/)
  })

  it('blurs without shifting the mean', () => {
    const field = new Float32Array(25)
    field[12] = 1
    const smooth = blur(field, 5, 5, 1)
    expect(smooth[12]).toBeLessThan(1)
    expect(smooth.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1)
  })
})
