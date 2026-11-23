/**
 * The embedded typefaces: Inter (text, tabular figures) and Instrument Serif (titles only), the
 * product's own pair. Fonts are input bytes, never system fonts, so the PDF renders identically
 * on every platform; `@pave/production/node` loads them from the fontsource packages and a
 * browser build passes the same files fetched by URL.
 */
import fontkit from '@pdf-lib/fontkit'
import type { FontFamily, FontWeight, MeasureText, TextStyle } from './drawing/model'
import { PT } from './drawing/model'

export interface FontSet {
  sans: Record<FontWeight, Uint8Array>
  serif: Uint8Array
}

/** Font files by role, as fontsource package paths (static weights, Latin subset, WOFF). */
export const FONT_FILES = {
  regular: '@fontsource/inter/files/inter-latin-400-normal.woff',
  medium: '@fontsource/inter/files/inter-latin-500-normal.woff',
  semibold: '@fontsource/inter/files/inter-latin-600-normal.woff',
  serif: '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff',
} as const

/** Tabular figures so columns of numbers align (Inter `tnum`); opt-in per style, since Inter's
 * `tnum` also widens hyphens in dates and SKUs. */
export const TABULAR = { tnum: true } as const

/** Stand-ins for symbols outside the Latin subsets. */
const FALLBACK: Record<string, string> = {
  '⌀': 'Ø',
  '≥': '>=',
  '≤': '<=',
  '≈': '~',
  '→': '->',
  '✓': '·',
  '−': '-',
  '‰': '/1000',
}

export interface Typesetter {
  fonts: FontSet
  measure: MeasureText
  /** Replaces characters the embedded font cannot draw. */
  safe(text: string, family?: FontFamily, weight?: FontWeight): string
}

export function createTypesetter(fonts: FontSet): Typesetter {
  const faces = {
    regular: fontkit.create(fonts.sans.regular),
    medium: fontkit.create(fonts.sans.medium),
    semibold: fontkit.create(fonts.sans.semibold),
    serif: fontkit.create(fonts.serif),
  }
  const face = (family: FontFamily = 'sans', weight: FontWeight = 'regular') =>
    family === 'serif' ? faces.serif : faces[weight]
  const safe = (text: string, family?: FontFamily, weight?: FontWeight) => {
    const f = face(family, weight)
    let out = ''
    for (const ch of text) {
      const cp = ch.codePointAt(0)!
      out += cp < 32 ? ' ' : f.hasGlyphForCodePoint(cp) ? ch : (FALLBACK[ch] ?? '?')
    }
    return out
  }
  const cache = new Map<string, number>()
  const measure = (text: string, style: TextStyle) => {
    const key = `${style.family}|${style.weight}|${style.tabular}|${text}`
    let em = cache.get(key)
    if (em === undefined) {
      const f = face(style.family, style.weight)
      const run = f.layout(
        safe(text, style.family, style.weight),
        style.tabular && style.family !== 'serif' ? TABULAR : undefined,
      )
      em = run.advanceWidth / f.unitsPerEm
      cache.set(key, em)
    }
    const tracking = (style.tracking ?? 0) * [...text].length
    return (em + tracking) * style.size * PT
  }
  return { fonts, measure, safe }
}
