/**
 * Text → outlines in millimetres, for engraving and for the freeform agent's text bodies.
 *
 * Four fonts are bundled, one per schema font id, all under the SIL Open Font License 1.1
 * (licence texts sit next to the files in ./fonts):
 *   sans   Inter                 serif  Playfair Display
 *   script Great Vibes           block  Bebas Neue
 * They are the Latin subsets as published by Fontsource (WOFF). Latin Extended-A letters they
 * lack (Ż, Ł, Č, Ő, ş, ğ …) are composed from their base letter and the font's own marks
 * (fonts/compose.ts); other characters a font lacks are drawn with its "missing glyph" box, as
 * any text renderer would.
 */
import type { Font, PathCommand } from 'opentype.js'
import * as opentypeModule from 'opentype.js'
import { composeLetter } from './fonts/compose'
import { gposKerning, type PairKerning } from './fonts/gposKerning'
import type { Vec2 } from './geometry/vec'
import { loadBundledAsset } from './runtime/host'

export type FontId = 'sans' | 'serif' | 'script' | 'block'

const FONT_FILES: Record<FontId, URL> = {
  sans: new URL('./fonts/sans.woff', import.meta.url),
  serif: new URL('./fonts/serif.woff', import.meta.url),
  script: new URL('./fonts/script.woff', import.meta.url),
  block: new URL('./fonts/block.woff', import.meta.url),
}

// Node resolves opentype.js to its CommonJS build (the API sits on `default`), bundlers to its
// ES module build (named exports); accept either.
type Opentype = { parse(buffer: ArrayBuffer): Font }
const namespace = opentypeModule as unknown as Partial<Opentype> & Record<string, unknown>
const opentype = (typeof namespace.parse === 'function' ? namespace : namespace.default) as Opentype

const fonts = new Map<FontId, Promise<Font>>()
/** GPOS pair kerning opentype.js cannot read (see fonts/gposKerning.ts), per parsed font. */
const pairKerning = new WeakMap<Font, PairKerning>()

/** Loads and parses a bundled font once. */
export function loadFont(id: FontId): Promise<Font> {
  let font = fonts.get(id)
  if (!font) {
    font = loadBundledAsset(FONT_FILES[id]).then((bytes) => {
      // opentype wants an ArrayBuffer that holds exactly the font.
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      const font = opentype.parse(copy.buffer)
      const kerning = gposKerning(copy)
      if (kerning) pairKerning.set(font, kerning)
      return font
    })
    fonts.set(id, font)
    font.catch(() => fonts.delete(id))
  }
  return font
}

export interface GlyphOutline {
  /** Closed contours (not repeated end points); holes are separate contours (even-odd fill). */
  contours: Vec2[][]
  /** Horizontal extent of the glyph's cell on its line: pen position before and after. */
  from: number
  to: number
  /** Which line (0 = first) the glyph is on. */
  line: number
}

export interface TextOutline {
  glyphs: GlyphOutline[]
  /** Advance width of the longest line, mm. */
  width: number
  /** Baseline-to-baseline distance, mm. Line n has its baseline at y = −n × lineHeight. */
  lineHeight: number
}

/** Points along a Bézier, excluding its start, fine enough to stay within `tolerance`. */
function flatten(points: readonly Vec2[], tolerance: number, out: Vec2[]): void {
  const [p0, p1, p2, p3] =
    points.length === 3 ? [points[0]!, points[1]!, points[2]!, undefined] : points
  // Distance of the control points from the chord bounds the curve's sagitta.
  const end = p3 ?? p2!
  const sag = Math.max(
    ...[p1!, ...(p3 ? [p2!] : [])].map((c) => {
      const dx = end[0] - p0![0]
      const dy = end[1] - p0![1]
      const l = Math.hypot(dx, dy) || 1
      return Math.abs((c[0] - p0![0]) * dy - (c[1] - p0![1]) * dx) / l
    }),
  )
  const steps = Math.min(64, Math.max(1, Math.ceil(Math.sqrt((0.75 * sag) / tolerance))))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    if (p3)
      out.push([
        u * u * u * p0![0] + 3 * u * u * t * p1![0] + 3 * u * t * t * p2![0] + t * t * t * p3[0],
        u * u * u * p0![1] + 3 * u * u * t * p1![1] + 3 * u * t * t * p2![1] + t * t * t * p3[1],
      ])
    else
      out.push([
        u * u * p0![0] + 2 * u * t * p1![0] + t * t * p2![0],
        u * u * p0![1] + 2 * u * t * p1![1] + t * t * p2![1],
      ])
  }
}

function contoursOf(commands: readonly PathCommand[], tolerance: number): Vec2[][] {
  const contours: Vec2[][] = []
  let current: Vec2[] = []
  const close = () => {
    const first = current[0]
    const last = current[current.length - 1]
    if (
      first &&
      last &&
      current.length > 1 &&
      Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9
    )
      current.pop()
    if (current.length >= 3) contours.push(current)
    current = []
  }
  for (const c of commands) {
    const at = current[current.length - 1]
    // opentype paths have y pointing down; ours points up.
    if (c.type === 'M') {
      close()
      current.push([c.x, -c.y])
    } else if (c.type === 'L') current.push([c.x, -c.y])
    else if (c.type === 'Q' && at) flatten([at, [c.x1, -c.y1], [c.x, -c.y]], tolerance, current)
    else if (c.type === 'C' && at)
      flatten([at, [c.x1, -c.y1], [c.x2, -c.y2], [c.x, -c.y]], tolerance, current)
    else if (c.type === 'Z') close()
  }
  close()
  return contours
}

/**
 * Lays out `text` (lines separated by "\n") with capital letters `size` mm tall. The first
 * baseline is y = 0 and each line starts at x = 0; curves are flattened to within `tolerance`.
 */
export function layoutText(font: Font, text: string, size: number, tolerance = 0.01): TextOutline {
  const capHeight = font.tables.os2?.sCapHeight || font.ascender * 0.75
  const em = (size * font.unitsPerEm) / capHeight
  const unit = em / font.unitsPerEm
  const lineHeight = size * 1.6
  const glyphs: GlyphOutline[] = []
  const extra = pairKerning.get(font)
  let width = 0
  text.split('\n').forEach((line, index) => {
    let pen = 0
    // One glyph per character: opentype.js cannot apply every substitution table these fonts
    // carry (contextual alternates), and engraved text does not need ligatures.
    const characters = Array.from(line)
    // A letter the font lacks is composed from its base letter and the font's marks (see
    // fonts/compose.ts); it spaces and kerns as its base letter.
    const outlineOf = (c: string) =>
      contoursOf(font.charToGlyph(c).getPath(0, 0, em).commands, tolerance)
    const composed = characters.map((c) =>
      font.charToGlyphIndex(c) === 0 ? composeLetter(font, c, em, outlineOf) : null,
    )
    const letters = characters.map((c, i) => composed[i]?.base ?? c)
    const run = letters.map((character) => font.charToGlyph(character))
    const ids = letters.map((character) => font.charToGlyphIndex(character))
    run.forEach((glyph, i) => {
      const from = pen
      pen += (glyph.advanceWidth ?? 0) * unit
      const next = run[i + 1]
      if (next) {
        // opentype.js reads `kern` tables and plain GPOS pairs; the rest comes from our reader.
        const k = font.getKerningValue(glyph, next) || (extra?.(ids[i]!, ids[i + 1]!) ?? 0)
        pen += k * unit
      }
      const shapes = composed[i]?.shapes.map((shape) =>
        shape.map((c) => c.map(([x, y]): Vec2 => [x + from, y - index * lineHeight])),
      ) ?? [contoursOf(glyph.getPath(from, index * lineHeight, em).commands, tolerance)]
      for (const contours of shapes)
        if (contours.length > 0) glyphs.push({ contours, from, to: pen, line: index })
    })
    width = Math.max(width, pen)
  })
  return { glyphs, width, lineHeight }
}

/** Whether the font lacks c but can compose it from its own letters and marks (fonts/compose.ts). */
export function canCompose(font: Font, c: string): boolean {
  if (font.charToGlyphIndex(c) !== 0) return false
  // At 1 mm to the em, coarsely: only whether the pieces exist matters here.
  return (
    composeLetter(font, c, 1, (g) =>
      contoursOf(font.charToGlyph(g).getPath(0, 0, 1).commands, 0.01),
    ) !== null
  )
}

/** Outlines of `text` in a bundled font; see {@link layoutText}. */
export async function textOutline(
  text: string,
  font: FontId,
  size: number,
  tolerance = 0.01,
): Promise<TextOutline> {
  return layoutText(await loadFont(font), text, size, tolerance)
}
