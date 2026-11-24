/**
 * Questions ranked by consequence (plan §8): how much the candidate answers differ in metal
 * weight, carats and outline. A question that changes nothing is never asked.
 */
import type { Question } from './types'

/** Below this a question is not worth a tap. A starting value, unmeasured. */
export const MIN_CONSEQUENCE = 0.01

/**
 * Consequence of a field: the largest, over its options, of the relative metal-weight change plus
 * the relative carat change plus the outline difference, each against the leading option (the
 * first). `xorFraction` is the share of the outline that differs from the leading option's.
 */
export function rankQuestions(
  c: {
    field: string
    options: { id: string; massG: number; carat: number; xorFraction: number }[]
  }[],
  cap = 3,
): Question[] {
  const out: Question[] = []
  for (const f of c) {
    const lead = f.options[0]
    if (!lead || f.options.length < 2) continue
    let best = 0
    let why = ''
    for (const o of f.options.slice(1)) {
      const dm = Math.abs(o.massG - lead.massG)
      const dc = Math.abs(o.carat - lead.carat)
      const v = dm / Math.max(lead.massG, 0.01) + dc / Math.max(lead.carat, 0.05) + o.xorFraction
      if (v > best) {
        best = v
        why = `${lead.id} or ${o.id}: ${dm.toFixed(2)} g of metal, ${dc.toFixed(2)} ct, ${(o.xorFraction * 100).toFixed(0)} % of the outline`
      }
    }
    if (best < MIN_CONSEQUENCE) continue
    out.push({ field: f.field, options: f.options.map((o) => o.id), consequence: best, why })
  }
  return out
    .sort((a, b) => b.consequence - a.consequence || (a.field < b.field ? -1 : 1))
    .slice(0, cap)
}
