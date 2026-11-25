/**
 * The one set of weights and carats the CAD screen shows, in the readout over the view and in
 * the Facts panel alike: the production check's once it has run on the design on screen (the
 * figures the overview and the cards show), the draft's, marked approximate, until then. Two
 * places choosing for themselves is how the panel came to say "≈ 3.6 g" beside a readout of
 * "3.24 g" for the same version.
 */
import type { Evaluation, Report } from '@pave/kernel'
import type { ProductionCheck } from './useProductionCheck'

export interface PieceFigures {
  report: Report
  /** From the production check of the design on screen; otherwise the draft's, approximate. */
  exact: boolean
}

/**
 * `checkedIsShown`: the check's design is the one on screen. While a value is dragged the view
 * runs ahead of the settled design the check was run on, and its numbers would be stale.
 */
export function pieceFigures(
  evaluation: Evaluation | null,
  check: ProductionCheck,
  checkedIsShown: boolean,
): PieceFigures | null {
  if (!evaluation) return null
  if (check.state === 'done' && checkedIsShown) return { report: check.report, exact: true }
  return { report: evaluation.report, exact: false }
}
