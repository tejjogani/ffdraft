/**
 * Discrete choices (prong count, head style, cut) are settled by building each candidate and
 * fitting it, never by a model's word alone (plan §7). The winner is "decided" only with a clear
 * margin; otherwise the choice goes to the jeweler as a question.
 */
import { applyOps, type Op } from '@pave/schema'
import { fitDesign } from './fit'
import type { FitInput, FitResult } from './types'

/** Runner-up loss over winner loss needed to decide. Consistent with the measured 1.2 to 6.7 range. */
export const DECIDE_MARGIN = 1.5
export const SCREEN_EVALUATIONS = 80

export async function chooseDiscrete(
  i: FitInput & { candidates: { id: string; ops: Op[] }[]; screen?: number },
): Promise<{
  ranked: { id: string; loss: number; result: FitResult }[]
  margin: number
  decided: boolean
}> {
  if (!i.candidates.length) throw new Error('chooseDiscrete: no candidates')
  const total = i.budget?.evaluations ?? 250
  const screen = Math.min(i.screen ?? SCREEN_EVALUATIONS, total)
  const withOps = (r: FitResult, ops: Op[]): FitResult => ({ ...r, ops: [...ops, ...r.ops] })

  // Screening is skipped when its budget would already finish the fit.
  const many = i.candidates.length > 2
  const screened: { id: string; ops: Op[]; result: FitResult }[] = []
  for (const c of i.candidates) {
    const design = applyOps(i.design, c.ops).design
    const result = await fitDesign({
      ...i,
      design,
      budget: { ...i.budget, evaluations: many ? screen : total },
    })
    screened.push({ id: c.id, ops: c.ops, result })
    if (result.stopped === 'aborted' && i.signal?.aborted) break
  }
  screened.sort((a, b) => a.result.loss - b.result.loss || (a.id < b.id ? -1 : 1))

  const finished: { id: string; loss: number; result: FitResult }[] = []
  for (const [k, s] of screened.entries()) {
    let r = s.result
    if (many && k < 2 && r.stopped === 'budget' && !i.signal?.aborted) {
      // Finish from where screening stopped: its values become the start, its cameras the prior.
      const base = applyOps(i.design, s.ops).design
      const values = new Map(r.params.map((p) => [p.key, p.value]))
      const params = i.params.map((p) => ({ ...p, start: values.get(p.key) ?? p.start }))
      const more = await fitDesign({
        ...i,
        design: base,
        params,
        cameras: { ...r.cameras, ...i.cameras },
        budget: { ...i.budget, evaluations: Math.max(1, total - r.evaluations) },
      })
      r = {
        ...more,
        evaluations: more.evaluations + r.evaluations,
        rasters: more.rasters + r.rasters,
      }
    }
    finished.push({ id: s.id, loss: r.loss, result: withOps(r, s.ops) })
  }
  finished.sort((a, b) => a.loss - b.loss || (a.id < b.id ? -1 : 1))
  const margin =
    finished.length > 1 ? finished[1]!.loss / Math.max(finished[0]!.loss, 1e-12) : Infinity
  return {
    ranked: finished,
    margin,
    decided: margin >= DECIDE_MARGIN && Number.isFinite(finished[0]!.loss),
  }
}
