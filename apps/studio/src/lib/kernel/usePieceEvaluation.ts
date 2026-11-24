/**
 * `usePieceEvaluation(pieceId, detail)`: the geometry of a piece as the window currently sees it,
 * for every screen that needs it (Design, Render, Sourcing, Production).
 *
 * The design comes from the piece's live session when one is open (so a scrub in the Design
 * tab is what every panel evaluates), otherwise from the `pieces.get` cache. While a new
 * evaluation runs the previous one is kept and flagged `stale`, so viewers never flash empty.
 */
import type { Detail, Evaluation } from '@pave/kernel'
import type { Design } from '@pave/schema'
import { useEffect, useState } from 'react'
import {
  type DesignSession,
  type SessionStore,
  useLiveSession,
  useSessionState,
} from '../design-session/store'
import { useRpc } from '../query'
import { evaluationScheduler, useKernelInfo, warmKernel } from './client'

export type EvaluationStatus = 'loading' | 'evaluating' | 'ready' | 'error' | 'unavailable'

export interface PieceEvaluation {
  /** The latest finished evaluation (possibly of an older design: see `stale`). */
  evaluation: Evaluation | null
  /** The design being shown or evaluated. */
  design: Design | null
  status: EvaluationStatus
  /** `evaluation` is not yet of `design`. */
  stale: boolean
  error: string | null
}

/** Scrubs whose dependent nodes cost more than this are evaluated on release only. */
const LIVE_BUDGET_MS = 150

/**
 * What to evaluate from a live session: the view, unless a gesture is scrubbing a node that is
 * too expensive to rebuild on every frame — then the settled design until it is released.
 */
function sessionDesign(session: DesignSession | null, detail: Detail) {
  return (s: SessionStore): Design => {
    if (!s.gesture || detail !== 'draft' || !session) return s.view
    const scheduler = evaluationScheduler(detail)
    const touched = new Set(s.gesture.ops.flatMap((op) => ('id' in op ? [op.id] : [])))
    for (const id of touched) if (scheduler.costOf(s.settled, id) > LIVE_BUDGET_MS) return s.settled
    return s.view
  }
}

export function usePieceEvaluation(pieceId: string, detail: Detail = 'draft'): PieceEvaluation {
  const session = useLiveSession(pieceId)
  const piece = useRpc('pieces.get', { id: pieceId }, { enabled: !session })
  const live = useSessionState(session, sessionDesign(session, detail))
  const design = live ?? piece.data?.design ?? null
  const kernel = useKernelInfo()
  const scheduler = evaluationScheduler(detail)
  const [result, setResult] = useState<{ design: Design; evaluation: Evaluation } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => warmKernel(), [])

  useEffect(() => {
    if (!design) return
    let current = true
    scheduler.request(`${pieceId}:${detail}`, design).then(
      (evaluation) => {
        if (!current || !evaluation) return
        setResult({ design, evaluation })
        setError(null)
      },
      (e: unknown) => {
        if (current) setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      current = false
    }
  }, [design, pieceId, detail, scheduler])

  const evaluation = result?.evaluation ?? null
  const stale = !!design && result?.design !== design
  const status: EvaluationStatus =
    kernel.status === 'unavailable' || kernel.status === 'crashed'
      ? 'unavailable'
      : error && stale
        ? 'error'
        : !evaluation
          ? 'loading'
          : stale
            ? 'evaluating'
            : 'ready'
  return { evaluation, design, status, stale, error }
}
