const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
]

/** "just now", "5 min. ago", "yesterday", "3 wk. ago". */
export function relativeTime(iso: string, now = Date.now()): string {
  let delta = (new Date(iso).getTime() - now) / 1000
  if (Math.abs(delta) < 45) return 'just now'
  for (const [unit, size] of STEPS) {
    // Rounded before it is compared: 59.6 s reads "1 min. ago", never "60 sec. ago".
    const rounded = Math.round(delta)
    if (Math.abs(rounded) < size) return rtf.format(rounded, unit)
    delta /= size
  }
  return ''
}

export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

const usdFmt = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})
const usdSmall = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 3,
  maximumFractionDigits: 4,
})
export const usd = (v: number): string =>
  (v !== 0 && Math.abs(v) < 0.1 ? usdSmall : usdFmt).format(v)

export const num = (v: number, digits = 2): string =>
  v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 })

export const grams = (v: number): string => `${num(v, v < 10 ? 2 : 1)} g`
/** Melee is weighed in thousandths: a 0.8 mm stone is 0.003 ct, not "0 ct". */
export const carats = (v: number): string => `${num(v, v !== 0 && Math.abs(v) < 0.1 ? 3 : 2)} ct`
export const mm = (v: number): string => `${num(v, 2)} mm`
export const compact = (v: number): string =>
  v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${num(n, 0)} ${n === 1 ? one : many}`

/** "33 seconds", "1 second", "1.2K tokens": a unit the ledger stores in the singular, counted. */
export const unitFor = (quantity: number, unit: string): string =>
  quantity === 1 || /s$/.test(unit) ? unit : `${unit}s`

/** Claude's display names where people read them; anything else as it is. */
const MODEL_NAMES: Record<string, string> = {
  'claude-fable-5-2': 'Claude Fable 5.2',
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  'claude-opus-5': 'Claude Opus 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-sonnet-5': 'Claude Sonnet 5',
}
export const modelName = (id: string): string => MODEL_NAMES[id] ?? id
