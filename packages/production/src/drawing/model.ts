/**
 * The drawing model: a sheet of vector items in paper millimetres (origin top-left, y down).
 * Built once, rendered by both the SVG writer and the PDF spec sheet, so the files a caster
 * opens and the pages they print are the same drawing.
 */

/** Line styles (ISO 128-2 type and weight, scaled for small-format jewellery sheets). */
export const PENS = {
  outline: { width: 0.3, color: '#1c1b1a' },
  stone: { width: 0.15, color: '#3a3836' },
  hidden: { width: 0.13, color: '#97958f', dash: [1.1, 0.7] },
  hatch: { width: 0.08, color: '#65635f' },
  center: { width: 0.1, color: '#97958f', dash: [5, 1, 0.8, 1] },
  cut: { width: 0.18, color: '#1c1b1a', dash: [5, 1, 0.8, 1] },
  dim: { width: 0.1, color: '#1c1b1a' },
  leader: { width: 0.1, color: '#4a4845' },
  frame: { width: 0.25, color: '#1c1b1a' },
} as const satisfies Record<string, { width: number; color: string; dash?: readonly number[] }>
export type Pen = keyof typeof PENS

export const INK = {
  fg: '#1c1b1a',
  muted: '#65635f',
  subtle: '#97958f',
  faint: '#c6c4bf',
  line: '#e7e6e3',
  paper: '#ffffff',
  danger: '#cf4436',
  warn: '#b97a12',
  ok: '#2c8f62',
} as const

export type FontFamily = 'sans' | 'serif'
export type FontWeight = 'regular' | 'medium' | 'semibold'

export interface TextStyle {
  size: number
  family?: FontFamily
  weight?: FontWeight
  color?: string
  /** Letter spacing in em (small caps-style labels). */
  tracking?: number
  /** Tabular figures (Inter `tnum`) for numbers that should align. */
  tabular?: boolean
}

export type Item =
  | { t: 'lines'; pen: Pen; lines: ArrayLike<number>[]; closed?: boolean }
  | { t: 'fill'; color: string; pts: number[] }
  | { t: 'circle'; cx: number; cy: number; r: number; pen?: Pen; fill?: string }
  | { t: 'rect'; x: number; y: number; w: number; h: number; pen?: Pen; fill?: string }
  | {
      t: 'text'
      x: number
      y: number
      text: string
      style: TextStyle
      anchor?: 'start' | 'middle' | 'end'
      /** Degrees counter-clockwise about (x, y). */
      rotate?: number
    }

export interface Sheet {
  width: number
  height: number
  items: Item[]
}

/** Width of a string in mm at a size in pt; implemented with the embedded fonts' metrics. */
export type MeasureText = (text: string, style: TextStyle) => number

export const PT = 25.4 / 72

/** Cap height of Inter / Instrument Serif ≈ 0.7 em; used to centre text on a line. */
export const capHeight = (sizePt: number) => sizePt * PT * 0.7
