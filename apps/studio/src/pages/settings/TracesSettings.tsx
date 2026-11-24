import type { Run, Step } from '@pave/schema'
import { AiMark, Chip, type ChipTone, EmptyState, InlineError, Skeleton } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Stat, StatGrid } from '../../components/Stats'
import { compact, dateTime, relativeTime, usd } from '../../lib/format'
import { useRpc } from '../../lib/query'
import { SettingsTitle } from './SettingsLayout'

const STATUS_TONE: Record<Run['status'], ChipTone> = {
  running: 'select',
  done: 'neutral',
  failed: 'danger',
  canceled: 'neutral',
  'awaiting-approval': 'warn',
  waiting: 'select',
  paused: 'warn',
}
const STATUS_LABEL: Record<Run['status'], string> = {
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  canceled: 'Canceled',
  'awaiting-approval': 'Needs approval',
  waiting: 'Waiting for a render',
  paused: 'Paused',
}

const duration = (r: Run) =>
  r.endedAt ? `${((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000).toFixed(1)} s` : '—'
const tokens = (r: Run) =>
  r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite

export function TracesSettings() {
  const runs = useRpc('traces.runs', { limit: 100 })
  return (
    <>
      <SettingsTitle
        title="Traces"
        description="Every assistant run: the model and tool steps, tokens and cost."
      />
      {runs.isError ? (
        <InlineError message={runs.error.message} onRetry={() => void runs.refetch()} />
      ) : runs.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : runs.data.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="When you work with the assistant, each run is recorded here."
        />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {runs.data.map((r) => (
            <li key={r.id}>
              <Link
                to="/settings/traces/$runId"
                params={{ runId: r.id }}
                className="group flex h-12 items-center gap-3 px-1 transition-colors hover:bg-bg-hover"
              >
                <AiMark className="size-3" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.model}</span>
                <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                <span className="hidden w-20 text-right font-mono text-xs text-fg-muted tabular sm:block">
                  {compact(tokens(r))} tok
                </span>
                <span className="w-16 text-right font-mono text-xs tabular">{usd(r.costUsd)}</span>
                <span
                  className="w-24 text-right text-xs text-fg-subtle"
                  title={dateTime(r.startedAt)}
                >
                  {relativeTime(r.startedAt)}
                </span>
                <ChevronRight
                  className="size-3.5 text-fg-faint group-hover:text-fg-muted"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export function TraceDetail({ runId }: { runId: string }) {
  const trace = useRpc('traces.run', { id: runId })
  if (trace.isError)
    return <InlineError message={trace.error.message} onRetry={() => void trace.refetch()} />
  if (trace.isPending) return <Skeleton className="h-64" />
  const { run, steps } = trace.data
  return (
    <>
      <Link to="/settings/traces" className="mb-4 inline-block text-xs text-fg-muted hover:text-fg">
        ← All runs
      </Link>
      <SettingsTitle
        title="Run"
        description={`${run.model} · started ${dateTime(run.startedAt)}`}
      />
      <StatGrid className="mb-8 sm:grid-cols-5">
        <Stat label="Status" value={STATUS_LABEL[run.status]} />
        <Stat label="Duration" value={duration(run)} />
        <Stat
          label="Input / output"
          value={`${compact(run.tokens.input)} / ${compact(run.tokens.output)}`}
        />
        <Stat label="Cache read" value={compact(run.tokens.cacheRead)} />
        <Stat label="Cost" value={usd(run.costUsd)} />
      </StatGrid>
      {run.pieceId && (
        <p className="-mt-4 mb-8 text-sm text-fg-muted">
          Worked on{' '}
          <Link
            to="/pieces/$id/history"
            params={{ id: run.pieceId }}
            className="text-fg underline decoration-line-strong underline-offset-2"
          >
            this piece
          </Link>
          .
        </p>
      )}
      {run.error && (
        <p className="mb-6 rounded-md bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] px-3 py-2 text-sm text-danger">
          {run.error}
        </p>
      )}
      <h2 className="mb-2 text-sm font-medium">Steps</h2>
      <ol className="divide-y divide-line border-y border-line">
        {steps.map((s) => (
          <StepRow key={s.id} step={s} />
        ))}
      </ol>
    </>
  )
}

function StepRow({ step }: { step: Step }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center gap-3 px-1 text-left hover:bg-bg-hover"
      >
        <span className="w-6 font-mono text-2xs text-fg-subtle tabular">{step.index + 1}</span>
        {step.kind === 'model' ? (
          <AiMark className="size-3" />
        ) : (
          <Wrench className="size-3.5 text-fg-subtle" aria-hidden />
        )}
        <span
          className={`min-w-0 flex-1 truncate font-mono text-xs ${step.isError ? 'text-danger' : ''}`}
        >
          {step.name}
        </span>
        {step.changeIds.length > 0 && (
          <Chip outline>
            {step.changeIds.length === 1 ? '1 change' : `${step.changeIds.length} changes`}
          </Chip>
        )}
        <span className="w-16 text-right font-mono text-2xs text-fg-subtle tabular">
          {step.ms} ms
        </span>
        <ChevronRight
          className={`size-3.5 text-fg-faint transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="grid gap-2 px-10 pb-3 sm:grid-cols-2">
          <Json label="Input" value={step.input} />
          <Json label="Output" value={step.output} />
        </div>
      )}
    </li>
  )
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-2xs text-fg-subtle">{label}</div>
      <pre className="max-h-64 overflow-auto rounded-md bg-bg-subtle p-2.5 font-mono text-2xs leading-4 text-fg-muted shadow-[inset_0_0_0_1px_var(--line)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
