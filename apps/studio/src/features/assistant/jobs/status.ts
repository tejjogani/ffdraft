/**
 * How an AI job reads on the piece: its state in plain words, where its plan stands, and which
 * tab each stage lives on. Pure, shared by the stepper, the job panel and the dock's strip.
 */
import { JOB_RECIPES } from '@pave/agent/studio'
import type { AiJob, JobStage, Run } from '@pave/schema'

export type JobState =
  | 'running'
  | 'waiting'
  /** Its tools started takes; it goes on by itself when they finish. */
  | 'rendering'
  | 'paused'
  | 'review'
  | 'accepted'
  | 'done'
  | 'failed'
  | 'stopped'

export function jobState(run: Pick<Run, 'status'> & { job: AiJob | null }): JobState {
  switch (run.status) {
    case 'running':
      return 'running'
    case 'awaiting-approval':
      return 'waiting'
    case 'waiting':
      return 'rendering'
    case 'paused':
      return 'paused'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'stopped'
    case 'done':
      return run.job?.review === 'pending'
        ? 'review'
        : run.job?.review === 'accepted'
          ? 'accepted'
          : 'done'
  }
}

export const JOB_STATE_LABEL: Record<JobState, string> = {
  running: 'Working',
  waiting: 'Needs your go-ahead',
  rendering: 'Rendering',
  paused: 'Paused',
  review: 'Ready for review',
  accepted: 'Accepted',
  done: 'Done',
  failed: 'Stopped by an error',
  stopped: 'Stopped',
}

/** Why a paused job paused, in a sentence. */
export function pausedWhy(job: AiJob): string {
  switch (job.pausedBy) {
    case 'edit':
      return 'Paused because you edited the piece. Resume replans from your edit and keeps it.'
    case 'takeover':
      return 'You took over. Resume when you want the job to carry on from here.'
    default:
      return 'Paused. Resume replans from the piece as it is now.'
  }
}

export interface PlanProgress {
  /** The step under way, or the first still to do. */
  current: AiJob['plan'][number] | null
  /** Steps finished (done or skipped). */
  finished: number
  total: number
}

export function planProgress(job: AiJob): PlanProgress {
  const finished = job.plan.filter((s) => s.state === 'done' || s.state === 'skipped').length
  const current =
    job.plan.find((s) => s.state === 'running') ??
    job.plan.find((s) => s.state === 'pending' || s.state === 'failed') ??
    null
  return { current, finished, total: job.plan.length }
}

/** The piece tab each stage lives on (the CAD stage keeps the `design` path it always had). */
export const STAGE_PATH = {
  design: '/pieces/$id/directions',
  cad: '/pieces/$id/design',
  render: '/pieces/$id/render',
} as const satisfies Record<JobStage, string>

export const stageLabel = (stage: JobStage): string => JOB_RECIPES[stage].label

/** Whether a job still wants attention on its piece (accepted and plain done ones do not). */
export const isOpenJob = (state: JobState): boolean => state !== 'accepted' && state !== 'done'

/** The newest job run of a stage among a piece's runs (newest first). */
export function latestJob(runs: readonly Run[] | undefined, stage: JobStage): Run | null {
  return runs?.find((r) => r.job?.stage === stage) ?? null
}

/** "1:05" from milliseconds. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const mm = h ? String(m % 60).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`
}

/** The job is still under way: working, waiting for a go-ahead, or waiting for its takes. */
export const isWorking = (state: JobState): boolean =>
  state === 'running' || state === 'waiting' || state === 'rendering'
