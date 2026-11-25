/**
 * Letters a bundled font lacks, composed from what it has. The fonts are Latin-1 subsets, so
 * Polish, Czech, Hungarian and Turkish names (Ż, Ł, Č, Ő, ş, ğ, İ …) have no glyph; a jeweler
 * would cut them from the font's own letters and accents, and so do we:
 *  - the base letter (the letter without its mark, by Unicode decomposition, or L for Ł),
 *  - the mark, cut from a Latin-1 letter that carries it (the acute of É and é, the cedilla of
 *    Ç), so it has the font's weight and its distance from the letter. Marks Latin-1 lacks are
 *    made from the nearest one it has: a caron is a circumflex upside down, a double acute two
 *    acutes, an ogonek a cedilla mirrored, a breve the lower half of the ring of Å, a dot above
 *    the dot of the i; the stroke of Ł is a bar as thick as the font's hyphen.
 * The mark is placed over (or under) the new base as it sat over its donor's base: centred on
 * it, at the same gap from its top (or bottom).
 */
import type { Font } from 'opentype.js'
import type { Vec2 } from '../geometry/vec'

type Contour = Vec2[]
type Contours = (glyph: string) => Contour[]

interface Box {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Mark → the Latin-1 letters (upper, lower) that carry it, their bases, and how it is changed. */
const MARKS: Record<
  string,
  { donor: [string, string]; base: [string, string]; below?: boolean; change?: Change }
> = {
  '́': { donor: ['É', 'é'], base: ['E', 'e'] },
  '̀': { donor: ['È', 'è'], base: ['E', 'e'] },
  '̂': { donor: ['Ê', 'ê'], base: ['E', 'e'] },
  '̌': { donor: ['Ê', 'ê'], base: ['E', 'e'], change: 'flip' },
  '̈': { donor: ['Ë', 'ë'], base: ['E', 'e'] },
  '̃': { donor: ['Ñ', 'ñ'], base: ['N', 'n'] },
  '̊': { donor: ['Å', 'å'], base: ['A', 'a'] },
  '̆': { donor: ['Å', 'å'], base: ['A', 'a'], change: 'breve' },
  '̋': { donor: ['É', 'é'], base: ['E', 'e'], change: 'double' },
  '̇': { donor: ['É', 'i'], base: ['E', 'ı'], change: 'dot' },
  '̧': { donor: ['Ç', 'ç'], base: ['C', 'c'], below: true },
  '̨': { donor: ['Ç', 'ç'], base: ['C', 'c'], below: true, change: 'mirror' },
}
type Change = 'flip' | 'breve' | 'double' | 'dot' | 'mirror'

/** Letters with a stroke through them, which Unicode does not decompose. */
const STROKES: Record<string, { base: string; at: number; slant: number; full?: boolean }> = {
  Ł: { base: 'L', at: 0.42, slant: 20 },
  ł: { base: 'l', at: 0.55, slant: 20 },
  Đ: { base: 'D', at: 0.5, slant: 0 },
  đ: { base: 'd', at: 0.82, slant: 0 },
  Ħ: { base: 'H', at: 0.72, slant: 0, full: true },
  ħ: { base: 'h', at: 0.8, slant: 0 },
}

/** Lowercase letters with an ascender: a caron there is set as a small apostrophe beside it. */
const ASCENDER_CARON = new Set(['d', 'l', 't', 'L'])

/** How the cedilla is cut from Ç: everything under C's bottom, and this share of the em above. */
const CEDILLA_NECK = 0.03

/** The base letter and marks of c, when the font can compose it; null otherwise. */
function recipe(font: Font, c: string): { base: string; marks: string[]; stroke?: string } | null {
  const has = (g: string) => font.charToGlyphIndex(g) !== 0
  const stroke = STROKES[c]
  if (stroke)
    return has(stroke.base) && has('-') ? { base: stroke.base, marks: [], stroke: c } : null
  const parts = Array.from(c.normalize('NFD'))
  const base = parts[0]
  const marks = parts.slice(1)
  if (!base || marks.length === 0 || !has(base)) return null
  for (const m of marks) {
    const mark = MARKS[m]
    if (!mark) return null
    if (![...mark.donor, ...mark.base].every(has)) return null
  }
  if (marks.includes('̌') && ASCENDER_CARON.has(base) && !has('’')) return null
  return { base, marks }
}

/** Whether the font lacks c but can compose it from its own letters and marks. */
export function canCompose(font: Font, c: string): boolean {
  return font.charToGlyphIndex(c) === 0 && recipe(font, c) !== null
}

function bounds(contours: readonly Contour[]): Box {
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  for (const c of contours)
    for (const [x, y] of c) {
      box.minX = Math.min(box.minX, x)
      box.maxX = Math.max(box.maxX, x)
      box.minY = Math.min(box.minY, y)
      box.maxY = Math.max(box.maxY, y)
    }
  return box
}

/**
 * The part of each contour on one side of the line y = t (above when `keepAbove`), by
 * Sutherland–Hodgman clipping. A concave contour cut in two comes back joined along the line by
 * edges of no area, which an even-odd fill ignores.
 */
function clip(contours: readonly Contour[], t: number, keepAbove: boolean): Contour[] {
  const inside = (p: Vec2) => (keepAbove ? p[1] >= t : p[1] <= t)
  const out: Contour[] = []
  for (const c of contours) {
    const kept: Contour = []
    for (let i = 0; i < c.length; i++) {
      const p = c[i]!
      const q = c[(i + 1) % c.length]!
      if (inside(p)) kept.push(p)
      if (inside(p) !== inside(q)) {
        const s = (t - p[1]) / (q[1] - p[1])
        kept.push([p[0] + s * (q[0] - p[0]), t])
      }
    }
    const box = bounds([kept])
    if (kept.length >= 3 && box.maxY - box.minY > 1e-9) out.push(kept)
  }
  return out
}

const mapped = (contours: readonly Contour[], f: (p: Vec2) => Vec2): Contour[] =>
  contours.map((c) => c.map(f))

/** The contours, reversed in order where a reflection would turn them inside out. */
const reflected = (contours: readonly Contour[], f: (p: Vec2) => Vec2): Contour[] =>
  mapped(contours, f).map((c) => c.reverse())

/** A rectangle `length` × `thick` centred on (cx, cy), turned `degrees` anticlockwise. */
function bar(cx: number, cy: number, length: number, thick: number, degrees: number): Contour {
  const a = (degrees * Math.PI) / 180
  const ux = Math.cos(a)
  const uy = Math.sin(a)
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([s, t]) => [
    cx + (s! * length * ux) / 2 - (t! * thick * uy) / 2,
    cy + (s! * length * uy) / 2 + (t! * thick * ux) / 2,
  ])
}

/** The x-intervals where the contours (even-odd) cross the line y, left to right. */
function slice(contours: readonly Contour[], y: number): [number, number][] {
  const xs: number[] = []
  for (const c of contours)
    for (let i = 0; i < c.length; i++) {
      const p = c[i]!
      const q = c[(i + 1) % c.length]!
      if (p[1] > y !== q[1] > y) xs.push(p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]))
    }
  xs.sort((a, b) => a - b)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i]!, xs[i + 1]!])
  return out
}

/**
 * The composed letter: its base glyph (for the advance and kerning) and its shapes, each filled
 * even-odd on its own (a stroke overlaps the stem it crosses, so it cannot share the base's
 * fill), in the coordinates `outline` gives for a glyph set `em` mm to the em. Null when the
 * font cannot compose c.
 */
export function composeLetter(
  font: Font,
  c: string,
  em: number,
  outline: Contours,
): { base: string; shapes: Contour[][] } | null {
  const r = recipe(font, c)
  if (!r) return null
  const base = outline(r.base)
  const box = bounds(base)
  const shapes: Contour[][] = [base]
  if (r.stroke) {
    const s = STROKES[r.stroke]!
    const hyphen = bounds(outline('-'))
    const thick = hyphen.maxY - hyphen.minY
    const y = box.minY + s.at * (box.maxY - box.minY)
    // Across the first stem standing at that height (the only one, for đ and ħ up there).
    const stem = slice(base, y)[0] ?? [box.minX, box.maxX]
    const length = s.full ? box.maxX - box.minX + thick : stem[1] - stem[0] + 3 * thick
    const cx = s.full ? (box.minX + box.maxX) / 2 : (stem[0] + stem[1]) / 2
    shapes.push([bar(cx, y, length, thick, s.slant)])
    return { base: r.base, shapes }
  }
  const upper = r.base.toUpperCase() === r.base && r.base.toLowerCase() !== r.base
  // Marks stack outward: a second mark above sits over the first.
  let top = box.maxY
  for (const m of r.marks) {
    const spec = MARKS[m]!
    const which = upper ? 0 : 1
    const donorBase = outline(spec.base[which])
    const donorBox = bounds(donorBase)
    let mark = spec.below
      ? clip(outline(spec.donor[which]), donorBox.minY + CEDILLA_NECK * em, false)
      : clip(outline(spec.donor[which]), donorBox.maxY + 1e-4 * em, true)
    if (mark.length === 0) return null
    let markBox = bounds(mark)
    if (spec.change === 'dot' && upper) {
      // The dot of the i, at the gap the font leaves between a capital and its acute.
      const acute = bounds(clip(outline('É'), donorBox.maxY + 1e-4 * em, true))
      const dotBase = bounds(outline('ı'))
      const dot = clip(outline('i'), dotBase.maxY + 1e-4 * em, true)
      if (dot.length === 0) return null
      const dotBox = bounds(dot)
      mark = mapped(dot, ([x, y]) => [
        x - (dotBox.minX + dotBox.maxX) / 2 + (donorBox.minX + donorBox.maxX) / 2,
        y - dotBox.minY + acute.minY,
      ])
      markBox = bounds(mark)
    }
    const mcx = (markBox.minX + markBox.maxX) / 2
    const mcy = (markBox.minY + markBox.maxY) / 2
    const w = markBox.maxX - markBox.minX
    if (spec.change === 'flip') mark = reflected(mark, ([x, y]) => [x, 2 * mcy - y])
    if (spec.change === 'mirror') mark = reflected(mark, ([x, y]) => [2 * mcx - x, y])
    if (spec.change === 'double') {
      const half = (k: number) =>
        mapped(mark, ([x, y]) => [mcx + (x - mcx) * 0.8 + k * 0.55 * w, mcy + (y - mcy) * 0.8])
      mark = [...half(-1), ...half(1)]
    }
    if (spec.change === 'breve') {
      // The lower half of the ring, as thick as the ring's own band.
      const inner = mark.length > 1 ? bounds([mark[1]!]) : null
      const outerR = w / 2
      const band = inner
        ? Math.max(0.15 * outerR, (w - (inner.maxX - inner.minX)) / 2)
        : 0.3 * outerR
      const cy = markBox.minY + outerR
      const arc: Contour = []
      const n = 16
      for (let k = 0; k <= n; k++) {
        const a = Math.PI + (k / n) * Math.PI
        arc.push([mcx + outerR * Math.cos(a), cy + outerR * Math.sin(a)])
      }
      for (let k = n; k >= 0; k--) {
        const a = Math.PI + (k / n) * Math.PI
        arc.push([mcx + (outerR - band) * Math.cos(a), cy + (outerR - band) * Math.sin(a)])
      }
      mark = [arc]
    }
    if (m === '̌' && ASCENDER_CARON.has(r.base)) {
      // ď ľ ť Ľ: the caron is a small apostrophe right of the ascender.
      const apostrophe = outline('’')
      const a = bounds(apostrophe)
      mark = mapped(apostrophe, ([x, y]) => [
        box.maxX + (x - a.minX) * 0.8,
        box.maxY - (a.maxY - y) * 0.8,
      ])
      shapes.push(mark)
      continue
    }
    markBox = bounds(mark)
    const dcx = (donorBox.minX + donorBox.maxX) / 2
    const bcx = (box.minX + box.maxX) / 2
    let dx = bcx - dcx
    let dy: number
    if (spec.below) {
      dy = box.minY - donorBox.minY
      // The ogonek hangs from the letter's right foot.
      if (spec.change === 'mirror') dx = box.maxX - 0.15 * w - markBox.maxX
    } else {
      // Keep the gap the donor leaves above its base, over the top of what is below (the base,
      // or the mark already set over it).
      dy = top - donorBox.maxY
    }
    mark = mapped(mark, ([x, y]) => [x + dx, y + dy])
    if (!spec.below) top = bounds(mark).maxY
    shapes.push(mark)
  }
  return { base: r.base, shapes }
}
