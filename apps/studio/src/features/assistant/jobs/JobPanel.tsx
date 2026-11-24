/**
 * The AI job on a piece's stage, for the person monitoring it: a bar under the stage tabs (the
 * stage, its goal, where the plan stands, time and cost so far, the controls) that opens into a
 * panel over the workspace with the plan step by step and every change the job made, each with
 * Undo. The workspace stays live underneath: the CAD updates as the job edits it.
 *
 * A job that is accepted (or plain done) gives the bar back to the workspace.
 */
import type { JobStage, Run, StoredChange } from '@pave/schema'
import { AiMark, Button, cn, IconButton, toast } from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { usd } from '../../../lib/format'
import { useRpc, useRpcMutation } from '../../../lib/query'
import { useRunActions } from '../actions'
import { callLabel, runHasLiveChanges } from '../model'
import { JobControls } from './JobControls'
import { JobPlan } from './JobPlan'
import {
  elapsed,
  isOpenJob,
  JOB_STATE_LABEL,
  jobState,
  pausedWhy,
  planProgress,
  STAGE_PATH,
  stageLabel,
} from './status'
import { useElapsed, useStageJob } from './useJob'

export function JobPanel({ pieceId, stage }: { pieceId: string; stage: JobStage }) {
  const { run } = useStageJob(pieceId, stage)
  const [open, setOpen] = useState(true)
  if (!run?.job) return null
  const state = jobState(run)
  if (!isOpenJob(state)) return null
  return <JobBar run={run} open={open} onToggle={() => setOpen((o) => !o)} />
}

function JobBar({ run, open, onToggle }: { run: Run; open: boolean; onToggle: () => void }) {
  const job = run.job!
  const state = jobState(run)
  const working = state === 'running' || state === 'waiting'
  const { current, finished, total } = planProgress(job)
  const ms = useElapsed(run.startedAt, run.endedAt, working)
  const navigate = useNavigate()

  return (
    <div className="relative z-30 border-b border-line bg-bg" data-job={run.id}>
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <AiMark className={cn('size-3.5', working && 'animate-pulse')} />
          {stageLabel(job.stage)} job
        </span>
        <span
          className={cn(
            'rounded-xs px-1.5 py-0.5 text-xs font-medium',
            state === 'review' && 'bg-select-soft text-select',
            state === 'paused' && 'bg-[color-mix(in_oklab,var(--warn)_13%,transparent)] text-warn',
            state === 'failed' &&
              'bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-danger',
            (working || state === 'stopped') && 'bg-bg-muted text-fg-muted',
          )}
        >
          {JOB_STATE_LABEL[state]}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
          {working && current ? `${current.label}…` : job.goal}
        </span>
        <span className="font-mono text-xs text-fg-subtle tabular">
          {finished}/{total} · {elapsed(ms)} · {usd(run.costUsd)}
        </span>
        <JobControls
          run={run}
          onTakeOver={() =>
            void navigate({ to: STAGE_PATH[job.stage], params: { id: run.pieceId! } })
          }
        />
        <IconButton
          icon={ChevronDown}
          label={open ? 'Hide the job’s plan' : 'Show the job’s plan'}
          aria-expanded={open}
          onClick={onToggle}
          className={cn('transition-transform', open && 'rotate-180')}
        />
      </div>
      {open && <JobDetail run={run} />}
    </div>
  )
}

/** The panel over the workspace: goal, plan and the changes made, with Undo. */
function JobDetail({ run }: { run: Run }) {
  const job = run.job!
  const state = jobState(run)
  const working = state === 'running' || state === 'waiting'
  const actions = useRunActions()
  const pieceId = run.pieceId
  const trace = useRpc('traces.run', { id: run.id })
  const history = useRpc(
    'design.history',
    { pieceId: pieceId ?? '', limit: 200 },
    { enabled: !!pieceId },
  )
  const revert = useRpcMutation('design.revert', { meta: { silent: true } })
  const byId = new Map((history.data ?? []).map((c) => [c.id, c]))
  const undone = new Set((history.data ?? []).flatMap((c) => c.reverts ?? []))
  const changes = (trace.data?.steps ?? [])
    .filter((s) => s.kind === 'tool' && s.changeIds.length > 0)
    .map((s) => ({
      step: s,
      label: callLabel(s.name, s.input, 'done').text,
      change: s.changeIds
        .map((id) => byId.get(id))
        .filter((c): c is StoredChange => !!c && !undone.has(c.id))
        .at(-1),
    }))

  return (
    <div className="absolute top-full right-3 z-30 mt-2 flex max-h-[min(560px,70vh)] w-[380px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg bg-bg shadow-lg ring-1 ring-line-strong">
      <div className="overflow-y-auto px-4 py-3">
        <p className="text-xs font-medium text-fg-subtle">Goal</p>
        <p className="mt-0.5 text-sm leading-6">{job.goal}</p>
        {state === 'paused' && (
          <p className="mt-2 rounded-md bg-[color-mix(in_oklab,var(--warn)_9%,transparent)] px-2.5 py-2 text-xs leading-5">
            {pausedWhy(job)}
          </p>
        )}
        {state === 'failed' && run.error && (
          <p className="mt-2 rounded-md bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] px-2.5 py-2 text-xs leading-5">
            {run.error}
          </p>
        )}
        {state === 'review' && (
          <p className="mt-2 rounded-md bg-select-soft px-2.5 py-2 text-xs leading-5">
            Done. Look it over: accept it, change anything by hand or by chat (“make the band
            thinner”), or re-run a step.
          </p>
        )}
        <p className="mt-3 mb-1 text-xs font-medium text-fg-subtle">Plan</p>
        <JobPlan
          job={job}
          redoing={actions.resuming}
          onRedo={
            working
              ? undefined
              : (stepId) =>
                  void actions
                    .resume(run.id, stepId)
                    .catch((e: Error) => toast.error('Couldn’t re-run that step', e.message))
          }
        />
        {changes.length > 0 && (
          <>
            <p className="mt-3 mb-1 text-xs font-medium text-fg-subtle">Changes</p>
            <ul className="flex flex-col gap-1">
              {changes.map(({ step, label, change }) => (
                <li key={step.id} className="flex min-h-7 items-center gap-2 text-sm">
                  <AiMark className="size-2.5 shrink-0" />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      !change && 'text-fg-subtle line-through',
                    )}
                  >
                    {label}
                  </span>
                  {change && (
                    <button
                      type="button"
                      disabled={revert.isPending}
                      onClick={() =>
                        revert.mutate(
                          { pieceId: change.pieceId, seq: change.seq },
                          { onError: (e) => toast.error('Couldn’t undo that', e.message) },
                        )
                      }
                      className="inline-flex h-6 items-center gap-1 rounded-xs px-1.5 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg"
                    >
                      <Undo2 className="size-3" aria-hidden /> Undo
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {pieceId && runHasLiveChanges(history.data, run.id) && !working && (
        <div className="flex justify-end border-t border-line px-4 py-2">
          <Button
            size="sm"
            variant="ghost"
            icon={Undo2}
            disabled={revert.isPending}
            onClick={() =>
              revert.mutate(
                { pieceId, runId: run.id },
                { onError: (e) => toast.error('Couldn’t undo the job', e.message) },
              )
            }
          >
            Undo all of it
          </Button>
        </div>
      )}
    </div>
  )
}
