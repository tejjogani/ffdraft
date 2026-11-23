/** Number formatting shared by drawings, tables and text files. Locale-independent on purpose. */

export type Units = 'mm' | 'in'

const MM_PER_IN = 25.4

/** Drawing precision: 0.01 mm resolves a jewellery tolerance (ring ID ±0.05 mm, research §1). */
export function fmtLength(mm: number, units: Units = 'mm'): string {
  if (units === 'in') return `${(mm / MM_PER_IN).toFixed(3)} [${mm.toFixed(2)}]`
  return mm.toFixed(mm >= 100 ? 1 : 2)
}

export const fmtFixed = (v: number, digits: number) => (Number.isFinite(v) ? v.toFixed(digits) : '—')

export const fmtGrams = (g: number) => `${g.toFixed(g < 10 ? 2 : 1)} g`

export const fmtCarat = (ct: number) => `${ct.toFixed(ct < 0.1 ? 3 : 2)} ct`

export function fmtMoney(v: number, currency: string): string {
  const abs = Math.abs(v).toFixed(2)
  const [int, frac] = abs.split('.')
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${v < 0 ? '−' : ''}${currency === 'USD' ? '$' : `${currency} `}${grouped}.${frac}`
}

export const fmtPct = (p: number) => `${Number(p.toFixed(2))}%`

/** "1 × Round brilliant" style counts: integers print without decimals. */
export const fmtCount = (n: number) => String(Math.round(n))

/** Ring-size display without the non-Latin-1 diameter sign, which the subset fonts lack. */
export const DIAMETER = 'Ø'
