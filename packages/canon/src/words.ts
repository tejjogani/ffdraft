/**
 * Brief words (PieceSpec.style, an intent's tags) matched as whole tokens or whole phrases, never
 * as substrings: "women's" is not "men", "statement" is not "men", "priced" is not "iced".
 */

/** Lower case, accents stripped, apostrophes dropped ("men's" → "mens"), other marks → spaces. */
export function tokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/** Whether `phrase` occurs as consecutive whole tokens in any of `words`. */
export function hasPhrase(words: readonly string[], phrase: string): boolean {
  const p = tokens(phrase)
  if (!p.length) return false
  return words.some((w) => {
    const t = tokens(w)
    for (let i = 0; i + p.length <= t.length; i++)
      if (p.every((x, k) => t[i + k] === x)) return true
    return false
  })
}

/** Whether any of `phrases` occurs in `words`. */
export const hasAny = (words: readonly string[], phrases: readonly string[]): boolean =>
  phrases.some((p) => hasPhrase(words, p))

/** Brief flags as phrase lists: explicit, so no ordinary word switches a rule family on. */
export const FLAG_PHRASES = {
  mens: ['men', 'mens', 'gents', 'gent', 'gentleman', 'gentlemans', 'masculine'],
  toi: ['toi et moi', 'toi moi', 'you and me', 'two stone'],
  eastWest: ['east west'],
  champion: ['championship', 'champion ring'],
  flushFit: ['flush fit', 'sits flush', 'wedding set', 'bridal set'],
} as const
