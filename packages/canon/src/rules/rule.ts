import type { Expr } from '../expr'
import type { Band, Rule, Source } from '../model'

/** Typed identity: keeps rule files terse while the compiler checks every field. */
export const rule = (r: Rule): Rule => r

export const band = (typical: Expr, min: Expr, max: Expr): Band => ({ typical, min, max })

/** A research 09 citation: evidence tag plus section. */
export const src = (tag: Source['tag'], ref: string): Source => ({ tag, ref })

/** Ring archetypes that carry a head. */
export const HEADED = ['solitaire', 'halo', 'threeStone'] as const
