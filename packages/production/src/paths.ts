/**
 * File names inside the bundle, safe on Windows, macOS and Linux: ASCII only, none of
 * `<>:"/\|?*` or control characters, no trailing dots or spaces, no reserved device names, and
 * length-capped. Zip entries always use forward slashes.
 */

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i
const MAX_SEGMENT = 64

/** One path segment (file or folder name) from arbitrary text. */
export function safeSegment(text: string, fallback = 'item', max = MAX_SEGMENT): string {
  const ascii = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-. ]+$/g, '')
  let out = ascii.slice(0, max).replace(/[-. ]+$/g, '') || fallback
  // Windows reserves device names even with an extension (CON.txt).
  if (RESERVED.test(out.split('.')[0]!)) out = `_${out}`
  return out
}

/** SKU slug used as the file-name stem: ASCII, upper case kept as typed, ≤ 40 characters. */
export const skuSlug = (sku: string) => safeSegment(sku, 'PIECE', 40)

/** `<sku>_r<rev>_production` — the single top-level folder of the zip (research Decisions). */
export const bundleRoot = (sku: string, revision: number) =>
  `${skuSlug(sku)}_r${revision}_production`

/** Joins safe segments with forward slashes; extensions are appended verbatim. */
export const joinPath = (...segments: string[]) => segments.join('/')

/** Makes `name` unique among `taken` by suffixing -2, -3, … before the extension. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) {
    taken.add(name.toLowerCase())
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase())
      return candidate
    }
  }
}
