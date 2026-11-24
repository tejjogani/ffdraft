/**
 * Ring size systems ↔ inner diameter (mm). Internally a ring is always an inner diameter;
 * size systems are a presentation concern.
 *
 *  - US/Canada: d = 11.63 + 0.8128 × size
 *  - UK/AU:     inner circumference = 37.5 + 1.25 mm per letter, A = 0 (half sizes = 0.5)
 *  - EU (ISO 8653): size = inner circumference in mm
 *  - JP:        the published chart (JIS: 13 mm at size 1, ⅓ mm of diameter per size, with
 *               circumferences rounded to 0.1 mm), looked up and interpolated
 *
 * Formulas as verified in docs/research/01-cad.md §3 (JewelCraft `ringsizelib`). Charts for
 * different systems disagree by up to half a size, so never round-trip through letters.
 */
export type RingSizeSystem = 'us' | 'uk' | 'eu' | 'jp' | 'mm'
export const RING_SIZE_SYSTEMS = ['us', 'uk', 'eu', 'jp', 'mm'] as const

export interface RingSize {
  system: RingSizeSystem
  /** Numeric for us/eu/jp/mm; for uk the letter index (A = 0) plus .5 for half sizes. */
  value: number
}

const US_BASE = 11.63
const US_STEP = 0.8128
const UK_BASE_CIRCUMFERENCE = 37.5
const UK_STEP_CIRCUMFERENCE = 1.25

/** Inner circumference (mm) of Japanese sizes 1–30, as printed on ring-size charts. */
const JP_CIRCUMFERENCE = Array.from(
  { length: 30 },
  (_, i) => Math.round(Math.PI * (13 + i / 3) * 10) / 10,
)

function jpDiameter(size: number): number {
  const last = JP_CIRCUMFERENCE.length - 1
  const i = Math.min(last - 1, Math.max(0, Math.floor(size - 1)))
  const t = size - 1 - i
  // Linear between chart entries, and extended along the end segments outside the chart.
  return (JP_CIRCUMFERENCE[i]! + t * (JP_CIRCUMFERENCE[i + 1]! - JP_CIRCUMFERENCE[i]!)) / Math.PI
}

export function ringInnerDiameter(size: RingSize): number {
  switch (size.system) {
    case 'us':
      return US_BASE + US_STEP * size.value
    case 'uk':
      return (UK_BASE_CIRCUMFERENCE + UK_STEP_CIRCUMFERENCE * size.value) / Math.PI
    case 'eu':
      return size.value / Math.PI
    case 'jp':
      return jpDiameter(size.value)
    case 'mm':
      return size.value
  }
}

export function ringSizeFromDiameter(d: number, system: RingSizeSystem): RingSize {
  const round = (v: number, step: number) => Math.round(v / step) * step
  switch (system) {
    case 'us':
      return { system, value: round((d - US_BASE) / US_STEP, 0.25) }
    case 'uk':
      return {
        system,
        value: round((d * Math.PI - UK_BASE_CIRCUMFERENCE) / UK_STEP_CIRCUMFERENCE, 0.5),
      }
    case 'eu':
      return { system, value: round(d * Math.PI, 0.5) }
    case 'jp':
      return { system, value: round((d - 13) * 3 + 1, 1) }
    case 'mm':
      return { system, value: round(d, 0.01) }
  }
}

export function formatRingSize(size: RingSize): string {
  switch (size.system) {
    case 'us':
      return `US ${size.value}`
    case 'uk': {
      const letter = String.fromCharCode(65 + Math.floor(size.value))
      return `UK ${letter}${size.value % 1 ? '½' : ''}`
    }
    case 'eu':
      return `EU ${size.value}`
    case 'jp':
      return `JP ${size.value}`
    case 'mm':
      return `⌀ ${size.value.toFixed(2)} mm`
  }
}

/** Common chain / necklace lengths (mm) with their trade names. */
export const NECKLACE_LENGTHS = [
  { label: 'Choker 14″', mm: 356 },
  { label: 'Choker 16″', mm: 406 },
  { label: 'Princess 18″', mm: 457 },
  { label: 'Matinee 20″', mm: 508 },
  { label: 'Matinee 22″', mm: 559 },
  { label: 'Opera 24″', mm: 610 },
  { label: 'Opera 30″', mm: 762 },
] as const
