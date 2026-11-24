/**
 * An AI job's plan, step by step with each step's state. Once the job has stopped, a finished
 * step can be run again (with the steps after it, which build on it).
 */
import type { AiJob } from '@pave/schema'
import { cn, Spinner } from '@pave/ui'
import { Check, Circle, CircleX, Minus, RotateCcw } from 'lucide-react'

const STATE_WORDS: Record<AiJob['plan'][number]['state'], string> = {
  pending: 'to do',
  running: 'under way',
  done: 'done',
  failed: 'failed',
  skipped: 'not needed',
}

export function JobPlan({
  job,
  onRedo,
  redoing,
}: {
  job: AiJob
  /** Offered on finished steps when the job is not working. */
  onRedo?: (stepId: string) => void
  redoing?: boolean
}) {
  return (
    <ol aria-label="Plan" className="flex flex-col">
      {job.plan.map((step, i) => (
        <li
          key={step.id}
          className="group flex min-h-8 items-center gap-2.5 text-sm"
          aria-label={`Step ${i + 1}: ${step.label}, ${STATE_WORDS[step.state]}`}
        >
          <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
            {step.state === 'running' ? (
              <Spinner className="size-3.5" label="" />
            ) : step.state === 'done' ? (
              <Check className="size-3.5 text-ok" />
            ) : step.state === 'failed' ? (
              <CircleX className="size-3.5 text-danger" />
            ) : step.state === 'skipped' ? (
              <Minus className="size-3.5 text-fg-faint" />
            ) : (
              <Circle className="size-3 text-fg-faint" />
            )}
          </span>
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              step.state === 'running' && 'font-medium',
              (step.state === 'pending' || step.state === 'skipped') && 'text-fg-muted',
            )}
          >
            {step.label}
          </span>
          {step.state === 'skipped' && <span className="text-xs text-fg-faint">not needed</span>}
          {onRedo && (step.state === 'done' || step.state === 'failed') && (
            <button
              type="button"
              disabled={redoing}
              onClick={() => onRedo(step.id)}
              className="hover-reveal inline-flex h-6 items-center gap-1 rounded-xs px-1.5 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg"
            >
              <RotateCcw className="size-3" aria-hidden /> Re-run
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}
