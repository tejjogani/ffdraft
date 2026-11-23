/**
 * CSV as Excel on Windows and Numbers on macOS open it without an import dialog: UTF-8 with a
 * byte-order mark (so "Pavé" and "µm" survive), CRLF line endings and RFC 4180 quoting. Text
 * cells that a spreadsheet would run as a formula are prefixed with an apostrophe (OWASP CSV
 * injection guidance), since names and notes come from users.
 */
export type Cell = string | number | boolean | null | undefined

const FORMULA = /^[=+\-@\t\r]/

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  const text = FORMULA.test(v) && !/^-?\d/.test(v) ? `'${v}` : v
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return `${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`
}

/** UTF-8 bytes with a BOM. */
export function encodeCsv(csv: string): Uint8Array {
  const body = new TextEncoder().encode(csv)
  const out = new Uint8Array(body.length + 3)
  out.set([0xef, 0xbb, 0xbf])
  out.set(body, 3)
  return out
}

/** Rounds for tables: fixed decimals, returned as a number so CSV stays numeric. */
export const round = (v: number, digits: number) => Number(v.toFixed(digits))
