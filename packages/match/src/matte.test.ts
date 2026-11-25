import { describe, expect, it } from 'vitest'
import { draftKernel, template } from './kernel.testkit'
import { subjectMatte } from './matte'
import { rasterize } from './raster'
import { shade, viewCamera } from './shade'
import type { Size } from './types'

const size: Size = { width: 320, height: 320 }

const iou = (a: Uint8Array, b: Uint8Array) => {
  let inter = 0
  let union = 0
  for (let k = 0; k < a.length; k++) {
    if (a[k] && b[k]) inter++
    if (a[k] || b[k]) union++
  }
  return inter / Math.max(1, union)
}

/** A synthetic product photo: the template shaded on a plain sweep; the truth is its raster. */
async function photo(templateId: string, view: Parameters<typeof viewCamera>[1]) {
  const k = draftKernel()
  const e = await k.evaluate(template(templateId))
  const camera = viewCamera(e, view)
  const rgba = shade(e, camera, size, { background: [250, 250, 248] })
  const truth = rasterize(e, camera, size).cls.map((c) => (c ? 1 : 0))
  return { rgba, truth }
}

describe('subjectMatte on synthetic photos from kernel renders', () => {
  it('cuts a solitaire out of a plain background from three-quarter and top views', async () => {
    for (const view of ['threeQuarter', 'top', 'front'] as const) {
      const { rgba, truth } = await photo('solitaire', view)
      const m = subjectMatte(rgba, size)
      expect(m.plain).toBe(true)
      expect(iou(m.matte, truth)).toBeGreaterThan(0.97)
    }
  }, 60_000)

  it('keeps the hole of a band seen from the front as background', async () => {
    const { rgba, truth } = await photo('wedding-band', 'front')
    // The truth has a hole: background pixels enclosed by the band.
    const m = subjectMatte(rgba, size)
    expect(iou(m.matte, truth)).toBeGreaterThan(0.95)
    const centre = (size.height / 2) * size.width + size.width / 2
    expect(truth[centre]).toBe(0)
    expect(m.matte[centre]).toBe(0)
  }, 60_000)

  it('says the background is not plain when the border is busy', async () => {
    const { rgba } = await photo('solitaire', 'threeQuarter')
    // A patterned backdrop: stripes across the whole frame behind the piece.
    const busy = rgba.slice()
    for (let y = 0; y < size.height; y++)
      for (let x = 0; x < size.width; x++) {
        const p = (y * size.width + x) * 4
        if (busy[p] === 250 && busy[p + 1] === 250 && (x >> 3) % 2) {
          busy[p] = 40
          busy[p + 1] = 90
          busy[p + 2] = 160
        }
      }
    const m = subjectMatte(busy, size)
    expect(m.plain).toBe(false)
    expect(m.reason).toMatch(/not plain/)
  }, 60_000)

  it('treats transparent pixels as background (a cut-out PNG)', () => {
    const w = 64
    const rgba = new Uint8Array(w * w * 4)
    // A dark disc on a fully transparent frame.
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++)
        if ((x - 32) ** 2 + (y - 32) ** 2 < 15 ** 2) {
          const p = (y * w + x) * 4
          rgba.set([60, 50, 40, 255], p)
        }
    const m = subjectMatte(rgba, { width: w, height: w })
    expect(m.plain).toBe(true)
    expect(m.coverage).toBeGreaterThan(0.15)
    expect(m.coverage).toBeLessThan(0.2)
  })
})
