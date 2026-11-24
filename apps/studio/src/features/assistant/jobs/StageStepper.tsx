/**
 * The piece's three stages in order, Design, then CAD, then Render, as tabs joined by arrows.
 * Each says where it stands: done (a spec, a CAD model, renders), an AI job working on it or
 * waiting for review, or not started. Each stage can be done entirely by hand, or by its job.
 */
import { JOB_STAGES, type JobStage, type Piece, type Run } from '@pave/schema'
import { AiMark, cn, tabClass } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Check, ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { useRpc } from '../../../lib/query'
import { isWorking, jobState, latestJob, STAGE_PATH, stageLabel } from './status'

type Mark = 'job' | 'review' | 'paused' | 'done' | null

function markOf(
  stage: JobStage,
  piece: Piece,
  runs: readonly Run[] | undefined,
  renders: number,
): Mark {
  const job = latestJob(runs, stage)
  if (job) {
    const state = jobState(job)
    if (isWorking(state)) return 'job'
    if (state === 'review') return 'review'
    if (state === 'paused') return 'paused'
  }
  const done =
    stage === 'design'
      ? !!piece.spec
      : stage === 'cad'
        ? piece.design.order.length > 0
        : renders > 0
  return done ? 'done' : null
}

const MARK_WORDS: Record<NonNullable<Mark>, string> = {
  job: 'an AI job is working on it',
  review: 'ready for review',
  paused: 'its AI job is paused',
  done: 'done',
}

export function StageStepper({ piece, className }: { piece: Piece; className?: string }) {
  const runs = useRpc('traces.runs', { pieceId: piece.id, limit: 20 })
  const renders = useRpc('renders.list', { pieceId: piece.id, limit: 1 })
  const renderCount = Array.isArray(renders.data) ? renders.data.length : 0
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {JOB_STAGES.map((stage, i) => {
        const mark = markOf(stage, piece, runs.data, renderCount)
        return (
          <Fragment key={stage}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-fg-faint" aria-hidden />}
            <Link
              to={STAGE_PATH[stage]}
              params={{ id: piece.id }}
              activeProps={{ 'aria-current': 'page' }}
              aria-label={`${i + 1}. ${stageLabel(stage)}${mark ? `, ${MARK_WORDS[mark]}` : ''}`}
              className={cn(
                tabClass,
                'gap-1.5 aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-0 aria-[current=page]:after:-bottom-px aria-[current=page]:after:h-px aria-[current=page]:after:bg-fg',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'inline-flex size-4 items-center justify-center rounded-full font-mono text-[10px] tabular',
                  mark === 'done'
                    ? 'bg-ok text-white'
                    : mark === 'review'
                      ? 'bg-select text-white'
                      : 'shadow-[inset_0_0_0_1px_var(--line-strong)] text-fg-subtle',
                )}
              >
                {mark === 'done' ? (
                  <Check className="size-2.5" strokeWidth={3} />
                ) : mark === 'job' ? (
                  <AiMark className="size-2.5 animate-pulse" />
                ) : (
                  i + 1
                )}
              </span>
              {stageLabel(stage)}
              {mark === 'paused' && <span aria-hidden className="size-1.5 rounded-full bg-warn" />}
            </Link>
          </Fragment>
        )
      })}
    </div>
  )
}
