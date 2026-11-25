import type { CrossSection } from 'manifold-3d'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadRuntime, runtime } from '../../runtime/index'
import { trianglesFromManifold } from '../../solid/solid'
import { edgeTopology } from '../topology'
import { OutlineDistance } from './distance'
import { edgeProfile, membraneDome, profiledSlab } from './profile'
import { SHAPES } from './shapes'
import { joinIslands, thickenStrokes, underline } from './stroke'
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

describe('joining loose parts of lettering', () => {
  const rect = (x: number, y: number, w: number, h: number): [number, number][] => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]

  it('ties block letters side to side, never over the cap line or under the baseline', () => {
    const { manifold: mf } = runtime()
    // Two bars 10 tall with a gap of 1: the nearest points are the corners, where a tie would
    // stick out above and below the letters.
    const letters = new mf.CrossSection([rect(0, 0, 2, 10), rect(3, 0, 2, 10)])
    const joined = joinIslands(letters, 0.5, 32)!
    expect(joined.ties).toBe(1)
    expect(joined.section.decompose()).toHaveLength(1)
    const box = joined.section.bounds()
    expect(box.min[1]).toBeCloseTo(0, 6)
    expect(box.max[1]).toBeCloseTo(10, 6)
  })

  it('sets the dot of an i down onto its stem instead of growing the stem with a tie', () => {
    const { manifold: mf } = runtime()
    // An l and an i joined at the baseline, as script letters are, and the i's dot 0.6 above
    // its stem: the l's side is nearer to the dot than the stem is, and must not take it.
    const letters = mf.CrossSection.union([
      new mf.CrossSection([rect(-0.9, 0, 0.6, 9)]),
      new mf.CrossSection([rect(-0.9, 0, 1.5, 0.6)]),
      new mf.CrossSection([rect(0, 0, 0.6, 5)]),
    ])
    const text = mf.CrossSection.union([letters, new mf.CrossSection([rect(0, 5.6, 0.6, 0.6)])])
    const joined = joinIslands(text, 0.5, 32)!
    expect(joined.section.decompose()).toHaveLength(1)
    // Nothing tied on (the dot only moved, overlapping the stem a little), nothing between the
    // dot and the l…
    expect(joined.section.area()).toBeLessThanOrEqual(text.area())
    expect(joined.section.area()).toBeGreaterThan(text.area() - 0.36 / 2)
    const gap = mf.CrossSection.intersection(
      joined.section,
      new mf.CrossSection([rect(-0.29, 4, 0.28, 3)]),
    )
    expect(gap.area()).toBeCloseTo(0, 9)
    // …and the i is no taller than its stem and dot: the dot came down onto the stem.
    const i = mf.CrossSection.intersection(
      joined.section,
      new mf.CrossSection([rect(0, 0, 0.6, 9)]),
    )
    expect(i.bounds().max[1]).toBeLessThan(5.6)
  })

  it('keeps accents where the font put them, each held on a narrow sprue straight down', () => {
    const { manifold: mf } = runtime()
    // A U with an umlaut over its arms, and an E with an acute over its top bar. Setting such
    // marks down as an i's dot is fused them into the letter: a U with notched prongs, an E
    // with a horn, and a name shorter than asked.
    const u = mf.CrossSection.union([
      new mf.CrossSection([rect(0, 0, 2, 10)]),
      new mf.CrossSection([rect(4, 0, 2, 10)]),
      new mf.CrossSection([rect(0, 0, 6, 2)]),
    ])
    const e = mf.CrossSection.union([
      new mf.CrossSection([rect(8, 0, 2, 10)]),
      new mf.CrossSection([rect(8, 8, 6, 2)]),
      new mf.CrossSection([rect(8, 0, 6, 2)]),
    ])
    const marks = new mf.CrossSection([
      rect(0.25, 11, 1.5, 1.5),
      rect(4.25, 11, 1.5, 1.5),
      rect(10.5, 11, 2, 1),
    ])
    const text = mf.CrossSection.union([u, e, marks])
    const joined = joinIslands(text, 0.5, 32, true)!
    expect(joined.section.decompose()).toHaveLength(1)
    expect(joined.section.bounds().max[1]).toBeCloseTo(12.5, 6)
    // The marks are where they were, whole…
    const above = (c: CrossSection) =>
      mf.CrossSection.intersection(c, new mf.CrossSection([rect(-1, 11, 20, 3)])).area()
    expect(above(joined.section)).toBeCloseTo(above(text), 6)
    // …and only the sprues cross the gap: narrower than the marks, one under each.
    const gap = mf.CrossSection.intersection(
      joined.section,
      new mf.CrossSection([rect(-1, 10.2, 20, 0.6)]),
    )
    const sprues = gap.decompose()
    expect(sprues).toHaveLength(3)
    for (const sprue of sprues) {
      const box = sprue.bounds()
      expect(box.max[0] - box.min[0]).toBeLessThanOrEqual(0.75 + 1e-6)
    }
  })

  it('hangs a dot set beside a sloping arm on a narrow sprue along the slope', () => {
    const { manifold: mf } = runtime()
    // A script u's dots stand to the right of its arms: nothing lies straight under them, and
    // they were left loose, to fall out of the casting.
    const arm = new mf.CrossSection([
      [
        [0, 0],
        [0.6, 0],
        [2.6, 5],
        [2, 5],
      ],
    ])
    const dot = new mf.CrossSection([rect(2.7, 5.6, 0.6, 0.6)])
    const text = mf.CrossSection.union([arm, dot])
    const joined = joinIslands(text, 0.5, 32, false)!
    expect(joined.section.decompose()).toHaveLength(1)
    // The dot is where it was, and the sprue is narrow: far less metal than a full tie.
    const above = (c: CrossSection) =>
      mf.CrossSection.intersection(c, new mf.CrossSection([rect(2, 5.6, 2, 1)])).area()
    expect(above(joined.section)).toBeCloseTo(above(text), 6)
    expect(joined.section.area() - text.area()).toBeLessThan(0.35)
  })

  it('hangs a round dot set beside a sloping arm by more than a point', () => {
    const { manifold: mf } = runtime()
    // A round dot whose nearest metal is the arm's top, down and to the left: the sloped sprue
    // was cut flat at the dot's lowest point, touched the round dot at a tangent only, and the
    // dot stayed loose with a stub standing in the gap.
    const arm = new mf.CrossSection([
      [
        [0, 0],
        [0.6, 0],
        [2.6, 5],
        [2, 5],
      ],
    ])
    const dot = mf.CrossSection.circle(0.36, 32).translate([3.2, 6.1])
    const text = mf.CrossSection.union([arm, dot])
    const joined = joinIslands(text, 0.5, 32, false)!
    const pieces = joined.section.decompose()
    expect(pieces).toHaveLength(1)
    // Joined across the sprue's width, not at a point: eroding by a tenth of a millimetre
    // leaves the dot on the arm.
    expect(joined.section.offset(-0.1, 'Round', 2, 32).decompose()).toHaveLength(1)
    // Narrow, and no longer than the gap: far less metal than a tie.
    expect(joined.section.area() - text.area()).toBeLessThan(0.45)
  })

  it("hangs the dots of an umlaut set over a capital's counter from its arms", () => {
    const { manifold: mf } = runtime()
    // A U whose dots stand over the counter, inside its arms, as a sans font sets them: straight
    // down there is only the bottom of the bowl, far below, and the dots were left loose.
    const u = mf.CrossSection.union([
      new mf.CrossSection([rect(0, 0, 1.2, 9)]),
      new mf.CrossSection([rect(4.8, 0, 1.2, 9)]),
      new mf.CrossSection([rect(0, 0, 6, 1.2)]),
    ])
    const dots = mf.CrossSection.union([
      mf.CrossSection.circle(0.7, 32).translate([2.2, 10.85]),
      mf.CrossSection.circle(0.7, 32).translate([3.8, 10.85]),
    ])
    const text = mf.CrossSection.union([u, dots])
    const joined = joinIslands(text, 0.5, 32, false)!
    expect(joined.section.decompose()).toHaveLength(1)
    // Nothing runs down through the counter.
    const counter = mf.CrossSection.intersection(
      joined.section,
      new mf.CrossSection([rect(1.3, 1.3, 3.4, 7.2)]),
    )
    expect(counter.area()).toBeCloseTo(0, 6)
    // The dots are where they were.
    const above = (c: CrossSection) =>
      mf.CrossSection.intersection(c, new mf.CrossSection([rect(-1, 10.6, 8, 2)])).area()
    expect(above(joined.section)).toBeCloseTo(above(text), 6)
  })

  it('bridges an umlaut dot that nothing under it can hold to its pair', () => {
    const { manifold: mf } = runtime()
    // A script Ü: the right dot stands over its arm, the left one over the counter, too far from
    // either arm for a sprue. A jeweler joins the pair with a short bar.
    const u = mf.CrossSection.union([
      new mf.CrossSection([rect(0, 0, 0.6, 9)]),
      new mf.CrossSection([rect(4.4, 0, 0.6, 9)]),
      new mf.CrossSection([rect(0, 0, 5, 0.6)]),
    ])
    const dots = mf.CrossSection.union([
      mf.CrossSection.circle(0.4, 32).translate([3, 10.9]),
      mf.CrossSection.circle(0.4, 32).translate([4.7, 10.9]),
    ])
    const text = mf.CrossSection.union([u, dots])
    const joined = joinIslands(text, 0.5, 32, false)!
    expect(joined.section.decompose()).toHaveLength(1)
    expect(joined.loose).toHaveLength(0)
    const counter = mf.CrossSection.intersection(
      joined.section,
      new mf.CrossSection([rect(0.7, 0.7, 3.6, 8.2)]),
    )
    expect(counter.area()).toBeCloseTo(0, 6)
    // A narrow bar between the dots, no taller than they are.
    const between = mf.CrossSection.intersection(
      joined.section,
      new mf.CrossSection([rect(3.45, 10, 0.8, 2)]),
    )
    expect(between.area()).toBeGreaterThan(0.2)
    expect(between.bounds().max[1] - between.bounds().min[1]).toBeLessThanOrEqual(0.8)
  })

  it('never ties the next letter to an accent', () => {
    const { manifold: mf } = runtime()
    // An accented letter, then a tall one (an á before an l or a k) whose top is nearer to the
    // accent than to the letter under it: a bar from it to the accent read as a stroke of the
    // letter and turned á into a different glyph.
    const a = new mf.CrossSection([rect(0, 0, 2.6, 5)])
    // Slanted, as a font's acute is, with points down its edge where a tie can land.
    const edge = Array.from({ length: 9 }, (_, k): [number, number] => [
      2.6 + 0.05 * k,
      5.5 + 0.1 * k,
    ])
    const acute = new mf.CrossSection([[[1.6, 5.5], ...edge, [2, 6.3]]])
    const l = new mf.CrossSection([rect(3.6, 0, 0.6, 9)])
    const text = mf.CrossSection.union([a, acute, l])
    const joined = joinIslands(text, 0.5, 32, true)!
    expect(joined.section.decompose()).toHaveLength(1)
    const between = mf.CrossSection.intersection(
      joined.section,
      new mf.CrossSection([rect(3.01, 5, 0.58, 1.5)]),
    )
    expect(between.area()).toBeCloseTo(0, 9)
  })

  it('meets each letter flush, never standing proud of the edge it joins', () => {
    const { manifold: mf } = runtime()
    // An L whose foot reaches toward an I: the nearest points are the foot's top corner and
    // the I, and a tie there stood above the foot, leaving a step.
    const l = mf.CrossSection.union([
      new mf.CrossSection([rect(0, 0, 2, 10)]),
      new mf.CrossSection([rect(0, 0, 4, 2)]),
    ])
    const text = mf.CrossSection.union([l, new mf.CrossSection([rect(5, 0, 2, 10)])])
    const joined = joinIslands(text, 0.5, 32)!
    expect(joined.section.decompose()).toHaveLength(1)
    const tie = mf.CrossSection.intersection(
      joined.section,
      new mf.CrossSection([rect(4, 0, 1, 10)]),
    )
    expect(tie.area()).toBeGreaterThan(0.4)
    expect(tie.bounds().max[1]).toBeLessThanOrEqual(2 + 1e-6)
    expect(tie.bounds().min[1]).toBeGreaterThanOrEqual(-1e-6)
  })

  it('stands the letters on a bar under their full width', () => {
    const { manifold: mf } = runtime()
    const letters = new mf.CrossSection([rect(0, 0, 2, 10), rect(4, 0, 2, 10)])
    const barred = underline(letters, 1)
    expect(barred.decompose()).toHaveLength(1)
    expect(barred.bounds().min[1]).toBeCloseTo(-0.5, 6)
    expect(barred.bounds().max[0]).toBeCloseTo(6, 6)
  })
})
