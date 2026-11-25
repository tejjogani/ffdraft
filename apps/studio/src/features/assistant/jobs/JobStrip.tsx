/**
 * An AI job in one line, in the dock under its conversation: stage, where the plan stands, and
 * the controls. The same job's full panel is on the piece.
 */
import type { Run } from '@pave/schema'
import { AiMark, cn } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { JobControls } from './JobControls'
import {
  isWorking,
  JOB_STATE_LABEL,
  jobState,
  planProgress,
  STAGE_PATH,
  stageLabel,
} from './status'

export function JobStrip({ run }: { run: Run }) {
  if (!run.job) return null
  const state = jobState(run)
  const { current, finished, total } = planProgress(run.job)
  const working = isWorking(state)
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-bg-subtle px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-center gap-2 text-xs">
        <AiMark className={cn('size-3', working && 'animate-pulse')} />
        <span className="font-medium">{stageLabel(run.job.stage)} job</span>
        <span className="text-fg-subtle">·</span>
        <span className="text-fg-muted">{JOB_STATE_LABEL[state]}</span>
        <span className="ml-auto font-mono text-fg-subtle tabular">
          {finished}/{total}
        </span>
      </div>
      {current && working && <p className="truncate text-sm">{current.label}…</p>}
      <div className="flex items-center justify-between gap-2">
        <JobControls run={run} showChat={false} primary={false} />
        {run.pieceId && (
          <Link
            to={STAGE_PATH[run.job.stage]}
            params={{ id: run.pieceId }}
            className="shrink-0 text-xs text-fg-muted hover:text-fg hover:underline"
          >
            Open job
          </Link>
        )}
      </div>
    </div>
  )
}
