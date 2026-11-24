import { describe, expect, it } from 'vitest'
import { components, dilate, distanceTransform, edges, erode, moments, resize } from './mask'
import { count } from './testkit'

const S = { width: 20, height: 10 }
function rect(x0: number, y0: number, x1: number, y1: number, s = S) {
  const m = new Uint8Array(s.width * s.height)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * s.width + x] = 1
  return m
}

describe('mask', () => {
  it('measures area and centroid as fractions', () => {
    const m = moments(rect(0, 0, 10, 10), S)
    expect(m.area).toBeCloseTo(0.5)
    expect(m.cx).toBeCloseTo(0.25)
    expect(m.cy).toBeCloseTo(0.5)
    expect(moments(new Uint8Array(200), S)).toEqual({ area: 0, cx: 0.5, cy: 0.5 })
  })

  it('marks 4-neighbour boundary pixels, counting the image border as outside', () => {
    const e = edges(rect(2, 2, 6, 6), S)
    expect(count(e)).toBe(12) // the ring of a 4 by 4 square
    expect(e[3 * 20 + 3]).toBe(0)
    expect(count(edges(rect(0, 0, 20, 10), S))).toBe(2 * 20 + 2 * 8)
  })

  it('computes a chamfer distance with weights 1 and √2', () => {
    const m = new Uint8Array(200)
    m[5 * 20 + 5] = 1
    const d = distanceTransform(m, S)
    expect(d[5 * 20 + 5]).toBe(0)
    expect(d[5 * 20 + 9]).toBeCloseTo(4)
    expect(d[8 * 20 + 8]).toBeCloseTo(3 * Math.SQRT2)
    expect(d[0 * 20 + 19]).toBeCloseTo(9 + 5 * Math.SQRT2, 5) // 5 diagonal steps and 9 straight
  })

  it('resizes by nearest sampling at pixel centres', () => {
    const r = resize(rect(0, 0, 10, 10), S, { width: 10, height: 5 })
    expect(count(r)).toBe(25)
    expect(r[4]).toBe(1)
    expect(r[5]).toBe(0)
  })

  it('finds 8-connected components with equivalent diameters', () => {
    const m = rect(0, 0, 3, 3)
    m[3 * 20 + 3] = 1 // touches diagonally: same component
    const big = rect(10, 2, 16, 8)
    for (let i = 0; i < m.length; i++) m[i] = m[i]! | big[i]!
    const c = components(m, S).sort((a, b) => a.area - b.area)
    expect(c.map((x) => x.area)).toEqual([10, 36])
    expect(c[1]!.cx).toBeCloseTo(13)
    expect(c[1]!.cy).toBeCloseTo(5)
    expect(c[1]!.d).toBeCloseTo(2 * Math.sqrt(36 / Math.PI))
  })

  it('dilates and erodes by whole pixels', () => {
    const m = rect(5, 3, 9, 7)
    expect(count(dilate(m, S, 1))).toBe(6 * 6 - 4) // chamfer disc of radius 1 keeps the corners out
    expect(count(erode(m, S, 1))).toBe(4)
    expect(count(erode(dilate(m, S, 2), S, 2))).toBe(16)
  })
})
