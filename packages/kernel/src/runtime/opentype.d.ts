/** The part of opentype.js (which ships no typings) that the kernel uses. */
declare module 'opentype.js' {
  export type PathCommand =
    | { type: 'M' | 'L'; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Z' }

  export interface Path {
    commands: PathCommand[]
  }

  export interface Glyph {
    advanceWidth?: number
    getPath(x: number, y: number, fontSize: number): Path
  }

  export interface Font {
    unitsPerEm: number
    ascender: number
    tables: { os2?: { sCapHeight?: number } }
    charToGlyph(character: string): Glyph
    /** 0 (the "missing glyph") for characters the font does not have. */
    charToGlyphIndex(character: string): number
    getKerningValue(left: Glyph, right: Glyph): number
  }

  export function parse(buffer: ArrayBuffer): Font
}
