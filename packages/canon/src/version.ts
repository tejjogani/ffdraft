/**
 * Content hashing: CANON_VERSION changes whenever anything that steers a suggestion, a lint or
 * the prompt changes: data by hash, code by ENGINE_REV.
 */
import { CAVEATS } from './caveats'
import { EXEMPLAR_SOURCES } from './exemplars/index'
import { FAILURE_MODES, PRINCIPLES, QUESTIONS, RUBRIC } from './rubric'
import { RULES } from './rules/index'
import { STYLES } from './styles/index'
import { RECIPE_PARAMS } from './suggest'
import * as TABLES from './tables'
import { FLAG_PHRASES } from './words'

/**
 * Bump by hand when code changes what the canon says without changing its data: measures,
 * facts, the suggestion passes, lint fixes, slice ranking, prompt layout.
 */
export const ENGINE_REV = 2

/** cyrb53: a small, fast, well-distributed 53-bit string hash, isomorphic and deterministic. */
export function hash(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

export const CANON_VERSION = `canon-${hash(
  JSON.stringify({
    ENGINE_REV,
    RULES,
    CAVEATS,
    STYLES,
    EXEMPLAR_SOURCES,
    TABLES,
    RUBRIC,
    FAILURE_MODES,
    QUESTIONS,
    PRINCIPLES,
    RECIPE_PARAMS,
    FLAG_PHRASES,
  }),
)}`
