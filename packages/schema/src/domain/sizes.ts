/**
 * Ring size systems ↔ inner diameter (mm). Internally a ring is always an inner diameter;
 * size systems are a presentation concern.
 *
 *  - US/Canada: d = 11.63 + 0.8128 × size
 *  - UK/AU:     one letter = half a US size, A = US ½ (12.04 mm)
 *  - EU (ISO 8653): size = inner circumference in mm
 *  - JP:        d = 13 + (size − 1) / 3
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

export function ringInnerDiameter(size: RingSize): number {
  switch (size.system) {
    case 'us':
      return US_BASE + US_STEP * size.value
    case 'uk':
      return US_BASE + US_STEP * (size.value / 2 + 0.5)
    case 'eu':
      return size.value / Math.PI
    case 'jp':
      return 13 + (size.value - 1) / 3
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
      return { system, value: round(((d - US_BASE) / US_STEP - 0.5) * 2, 0.5) }
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
