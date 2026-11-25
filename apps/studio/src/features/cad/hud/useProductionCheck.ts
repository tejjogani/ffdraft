/**
 * The casting check: a production-detail evaluation (seats cut, beads, fused metal) of the
 * settled design, run on the production worker two seconds after editing stops. Its
 * diagnostics are the only ones allowed to say "Ready to cast".
 */
import type { Diagnostic, Report } from '@pave/kernel'
import type { Design } from '@pave/schema'
import { useEffect, useState } from 'react'
import { evaluationScheduler } from '../../../lib/kernel/client'

export type ProductionCheck =
  | { state: 'idle' | 'running' }
  /**
   * `report`: the production weights and carats, the same evaluation the piece's stored facts
   * come from, so the readout and the overview agree once the check has run.
   */
  | { state: 'done'; diagnostics: Diagnostic[]; report: Report }
  | { state: 'failed'; error: string }

const IDLE_MS = 2000

export function useProductionCheck(
  pieceId: string,
  design: Design | null,
  enabled: boolean,
): ProductionCheck {
  const [result, setResult] = useState<{ design: Design; check: ProductionCheck } | null>(null)

  useEffect(() => {
    if (!design || !enabled) return
    let current = true
    const timer = setTimeout(() => {
      setResult({ design, check: { state: 'running' } })
      evaluationScheduler('production')
        .request(`${pieceId}:check`, design)
        .then(
          (e) => {
            if (current && e)
              setResult({
                design,
                check: { state: 'done', diagnostics: e.diagnostics, report: e.report },
              })
          },
          (err: unknown) => {
            if (current) setResult({ design, check: { state: 'failed', error: String(err) } })
          },
        )
    }, IDLE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [pieceId, design, enabled])

  // A check of an older version says nothing about this one.
  if (!result || result.design !== design) return { state: 'idle' }
  return result.check
}
