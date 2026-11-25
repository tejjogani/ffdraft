import { describe, expect, it } from 'vitest'
import { carats, compact, grams, mm, num, plural, relativeTime, usd } from './format'

/** The same formatter `relativeTime` uses, so the tests hold in any locale. */
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })
const NOW = Date.parse('2026-01-10T12:00:00Z')
const ago = (seconds: number) => relativeTime(new Date(NOW - seconds * 1000).toISOString(), NOW)
const MIN = 60
const HOUR = 3600
const DAY = 86_400

describe('relativeTime', () => {
  it('reads the last 45 seconds, either way, as just now', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(44)).toBe('just now')
    expect(ago(-30)).toBe('just now')
  })

  it('picks the unit by size', () => {
    expect(ago(50)).toBe(rtf.format(-50, 'second'))
    expect(ago(5 * MIN)).toBe(rtf.format(-5, 'minute'))
    expect(ago(3 * HOUR)).toBe(rtf.format(-3, 'hour'))
    expect(ago(DAY)).toBe(rtf.format(-1, 'day'))
    expect(ago(3 * 7 * DAY)).toBe(rtf.format(-3, 'week'))
    expect(ago(90 * DAY)).toBe(rtf.format(-3, 'month'))
    expect(ago(800 * DAY)).toBe(rtf.format(-2, 'year'))
  })

  it('never shows a full unit’s worth of the smaller unit ("60 sec. ago", "24 hr. ago")', () => {
    expect(ago(59.6)).toBe(rtf.format(-1, 'minute'))
    expect(ago(HOUR - 1)).toBe(rtf.format(-1, 'hour'))
    expect(ago(DAY - 1)).toBe(rtf.format(-1, 'day'))
    expect(ago(6.6 * DAY)).toBe(rtf.format(-1, 'week'))
    expect(ago(364 * DAY)).toBe(rtf.format(-1, 'year'))
  })

  it('reads the future too, and says nothing for a date it cannot parse', () => {
    expect(ago(-2 * HOUR)).toBe(rtf.format(2, 'hour'))
    expect(relativeTime('not a date', NOW)).toBe('')
  })
})

describe('weights and measures', () => {
  const n = (v: number, digits: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: digits })

  it('shows grams to 0.01 below ten grams and to 0.1 above', () => {
    expect(grams(3.456)).toBe(`${n(3.46, 2)} g`)
    expect(grams(12.345)).toBe(`${n(12.3, 1)} g`)
    expect(grams(0)).toBe('0 g')
  })

  it('shows carats to 0.01, without trailing zeros', () => {
    expect(carats(1.5)).toBe(`${n(1.5, 2)} ct`)
    expect(carats(1.234)).toBe(`${n(1.23, 2)} ct`)
    expect(carats(0)).toBe('0 ct')
  })

  it('shows a melee stone’s weight to 0.001: a 0.8 mm diamond is not "0 ct"', () => {
    expect(carats(0.0026)).toBe(`${n(0.003, 3)} ct`)
    expect(carats(0.004)).toBe(`${n(0.004, 3)} ct`)
    expect(carats(0.0951)).toBe(`${n(0.095, 3)} ct`)
  })

  it('shows millimetres to 0.01 and counts with the right noun', () => {
    expect(mm(2.345)).toBe(`${n(2.35, 2)} mm`)
    expect(num(2, 2)).toBe('2')
    expect(plural(1, 'stone')).toBe('1 stone')
    expect(plural(0, 'stone')).toBe('0 stones')
    expect(plural(1200, 'stone')).toBe(`${n(1200, 0)} stones`)
    expect(plural(2, 'box', 'boxes')).toBe('2 boxes')
  })
})

describe('money and large numbers', () => {
  const digits = (s: string) => s.replace(/[^0-9]/g, '')

  it('shows dollars and cents, and sub-ten-cent costs with enough digits to tell apart', () => {
    expect(digits(usd(1234.5))).toBe('123450')
    expect(digits(usd(0))).toBe('000')
    expect(digits(usd(0.0123))).toBe('00123')
    expect(digits(usd(0.004))).toBe('0004')
    expect(usd(0.5)).not.toBe(usd(0.05))
  })

  it('abbreviates large counts', () => {
    expect(compact(950)).toBe((950).toLocaleString())
    expect(compact(12_345)).toBe(
      (12_345).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 }),
    )
  })
})
