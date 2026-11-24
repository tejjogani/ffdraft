import { beforeAll, describe, expect, it } from 'vitest'
import { loadRuntime, runtime } from '../../runtime/index'
import { trianglesFromManifold } from '../../solid/solid'
import { edgeTopology } from '../topology'
import { OutlineDistance } from './distance'
import { edgeProfile, membraneDome, profiledSlab } from './profile'
import { SHAPES } from './shapes'
import { thickenStrokes } from './stroke'
import { parseSvgPath } from './svgPath'

beforeAll(() => loadRuntime())

const area = (c: [number, number][]) =>
  c.reduce(
    (s, p, i) => s + (p[0] * c[(i + 1) % c.length]![1] - c[(i + 1) % c.length]![0] * p[1]) / 2,
    0,
  )

describe('SVG path data', () => {
  it('handles absolute and relative lines, H/V, implicit repeats and compact numbers', () => {
    const [a] = parseSvgPath('M0,0 10,0 10 10 H0 Z', 0.01)
    const [b] = parseSvgPath('m0 0h10v10h-10.0z', 0.01)
    const [c] = parseSvgPath('M0 0L1e1 0 10 1e1L.0 10z', 0.01)
    for (const contour of [a!, b!, c!]) expect(Math.abs(area(contour))).toBeCloseTo(100, 9)
  })

  it('flattens cubic, smooth, quadratic and arc segments within tolerance', () => {
    // A circle of radius 10 as two arcs (with unseparated flags), as cubics, and as quadratics.
    const arc = parseSvgPath('M10 0A10 10 0 11-10 0A10 10 0 1110 0Z', 0.001)[0]!
    expect(Math.abs(area(arc))).toBeCloseTo(Math.PI * 100, 1)
    for (const p of arc) expect(Math.hypot(p[0], p[1])).toBeCloseTo(10, 2)
    const k = 0.5523 * 10
    const cubic = parseSvgPath(
      `M10 0C10 ${k} ${k} 10 0 10S-10 ${k}-10 0 ${-k} -10 0 -10 10 ${-k} 10 0z`,
      0.001,
    )[0]!
    expect(Math.abs(area(cubic))).toBeCloseTo(Math.PI * 100, 0)
    const quad = parseSvgPath('M0 0Q5 10 10 0T20 0z', 0.001)[0]!
    expect(Math.max(...quad.map((p) => p[1]))).toBeCloseTo(5, 2)
    expect(Math.min(...quad.map((p) => p[1]))).toBeCloseTo(-5, 2)
  })

  it('applies even-odd and non-zero to nested subpaths', () => {
    const { manifold: mf } = runtime()
    // Two same-direction squares, one inside the other.
    const contours = parseSvgPath('M0 0H10V10H0Z M3 3H7V7H3Z', 0.01)
    const nonZero = new mf.CrossSection(contours, 'NonZero')
    const evenOdd = new mf.CrossSection(contours, 'EvenOdd')
    expect(nonZero.area()).toBeCloseTo(100, 6)
    expect(evenOdd.area()).toBeCloseTo(84, 6)
    nonZero.delete()
    evenOdd.delete()
  })

  it('reports malformed data', () => {
    expect(() => parseSvgPath('1 1 L 2 2', 0.1)).toThrow(/move command/)
    expect(() => parseSvgPath('M 0 0 A 1 1 0 2 0 3 3', 0.1)).toThrow(/arc flag/)
    expect(() => parseSvgPath('M 0 0 L 1', 0.1)).toThrow(/malformed/)
    expect(() => parseSvgPath('M 0 0 L 1e400 5 L 3 3 Z', 0.1)).toThrow(/malformed/)
    // Open or empty paths enclose nothing.
    expect(parseSvgPath('', 0.1)).toEqual([])
    expect(parseSvgPath('M0 0 L10 10', 0.1)).toEqual([])
  })

  it('parses every named shape into one closed outline', () => {
    for (const d of Object.values(SHAPES)) expect(parseSvgPath(d, 0.001)).toHaveLength(1)
  })
})

describe('outline geometry', () => {
  it('measures distance to an outline and tests inside', () => {
    const d = new OutlineDistance(parseSvgPath('M0 0H10V10H0Z M4 4V6H6V4Z', 0.01))
    expect(d.distance(2, 5)).toBeCloseTo(2, 9)
    expect(d.distance(5, 5)).toBeCloseTo(1, 9)
    expect(d.inside(2, 5)).toBe(true)
    expect(d.inside(5, 5)).toBe(false)
    expect(d.signed(-1, 5)).toBeCloseTo(-1, 9)
    expect(d.distance(5, -20, 3)).toBe(3)
  })

  it('thickens hairlines but leaves corners alone', () => {
    const { manifold: mf } = runtime()
    const square = mf.CrossSection.square([10, 10], true)
    expect(thickenStrokes(square, 0.35, 64)).toBeNull()
    const stem = mf.CrossSection.square([6, 0.15]).translate([5, -0.075])
    const hairline = mf.CrossSection.union(square, stem)
    const thick = thickenStrokes(hairline, 0.35, 64)!
    expect(thick.area()).toBeGreaterThan(hairline.area() + 1)
    for (const c of [square, stem, hairline, thick]) c.delete()
  })

  it('extrudes every edge profile into a closed solid of the right thickness', () => {
    const { manifold: mf } = runtime()
    const outline = new mf.CrossSection(parseSvgPath(SHAPES.heart, 1e-3), 'NonZero').scale(10)
    const distance = new OutlineDistance(outline.toPolygons())
    for (const style of ['flat', 'chamfer', 'round', 'pillow'] as const) {
      const slab = profiledSlab({
        outline,
        distance,
        profile: edgeProfile(style, 0.8, 3, 7),
        segments: 64,
        resolution: 0.3,
      })
      expect(edgeTopology(trianglesFromManifold(slab)).open).toBe(0)
      expect(slab.boundingBox().max[2]).toBeCloseTo(3, 2)
      expect(slab.boundingBox().min[2]).toBeCloseTo(0, 9)
      slab.delete()
    }
    const dome = membraneDome(distance, outline.bounds(), 0.8, 3, 6, 0.1)
    // Highest in the middle, edge lower by the rise, never steeper than R = 6 mm allows.
    expect(dome.height(0, 0, 0)).toBeLessThanOrEqual(3 + 1e-9)
    expect(dome.height(0, 0, -9.9)).toBeLessThan(dome.height(0, 0, 0))
    outline.delete()
  })
})
