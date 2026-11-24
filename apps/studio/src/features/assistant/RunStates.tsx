/**
 * How a run stands, under the conversation: working (with Stop), stopped, failed (said by code,
 * with what to do: Retry, a stronger or another tier, Settings), paused at the run cap
 * ("Paused at $3 · Continue"), and the footer of a finished run: tokens, cost and Undo all.
 */
import { RUN_CAP_USD } from '@pave/agent/studio'
import type { Run } from '@pave/schema'
import { AiMark, Button, cn, Spinner } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { CircleAlert, CircleStop, Undo2 } from 'lucide-react'
import { usd } from '../../lib/format'
import { useIsAdmin } from './KeyForm'
import { tokenCount } from './model'

export function WorkingPill({ onStop, label }: { onStop: () => void; label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-bg-subtle px-2.5 py-1.5 text-xs text-fg-muted shadow-[inset_0_0_0_1px_var(--line)]">
      <Spinner className="size-3" label="Working" />
      <span className="min-w-0 flex-1 truncate">{label ?? 'Assistant is working'}</span>
      <button
        type="button"
        onClick={onStop}
        className="inline-flex h-6 items-center gap-1 rounded-xs px-1.5 text-fg hover:bg-bg-hover"
        title="Stop (Esc)"
      >
        <CircleStop className="size-3" aria-hidden /> Stop
      </button>
    </div>
  )
}

export function CapPill({ onContinue, busy }: { onContinue: () => void; busy: boolean }) {
  return (
    <div className="flex items-center gap-2 self-start rounded-md bg-[color-mix(in_oklab,var(--warn)_10%,transparent)] px-2.5 py-1.5 text-xs">
      <span>Paused at {usd(RUN_CAP_USD)}</span>
      <span aria-hidden className="text-fg-subtle">
        ·
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onContinue}
        className="font-medium underline-offset-2 hover:underline disabled:opacity-50"
      >
        Continue
      </button>
    </div>
  )
}

export interface ErrorActions {
  retry: () => void
  /** Retry on another tier (a model that is not available, a refusal on Light). */
  retryOn: (tier: 'standard' | 'power') => void
  rephrase: () => void
  busy: boolean
}

/** What to say and offer for each way a run can fail. */
export function RunError({ run, actions }: { run: Run; actions: ErrorActions }) {
  const admin = useIsAdmin()
  const code = run.errorCode
  const title =
    code === 'rate_limited'
      ? 'Claude is busy right now'
      : code === 'provider_auth'
        ? 'The API key was not accepted'
        : code === 'provider_unreachable'
          ? 'Couldn’t reach Claude’s API'
          : code === 'model_unavailable'
            ? 'That model isn’t available'
            : code === 'refusal'
              ? 'Claude declined this request'
              : code === 'interrupted'
                ? 'The run was interrupted'
                : code === 'budget_exceeded'
                  ? 'The monthly AI budget is spent'
                  : 'Something went wrong'
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg bg-[color-mix(in_oklab,var(--danger)_6%,transparent)] px-3.5 py-3 text-sm shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_25%,transparent)]"
    >
      <p className="flex items-center gap-1.5 font-medium">
        <CircleAlert className="size-4 text-danger" aria-hidden />
        {title}
      </p>
      {run.error && <p className="text-fg-muted">{run.error}</p>}
      <p className="text-xs text-fg-subtle">Edits made before this stay, and can be undone.</p>
      <div className="flex flex-wrap gap-1.5">
        {code === 'provider_auth' || code === 'budget_exceeded' ? (
          admin ? (
            <Link
              to={code === 'budget_exceeded' ? '/settings/usage' : '/settings/ai'}
              className="inline-flex h-7 items-center rounded-md px-2.5 text-sm shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-bg-subtle"
            >
              {code === 'budget_exceeded' ? 'Open Usage' : 'Open Settings, AI'}
            </Link>
          ) : (
            <span className="text-xs text-fg-muted">
              Ask an owner or admin of the organisation.
            </span>
          )
        ) : code === 'refusal' ? (
          <>
            <Button size="sm" onClick={actions.rephrase}>
              Rephrase
            </Button>
            {run.tier === 'light' && (
              <Button size="sm" disabled={actions.busy} onClick={() => actions.retryOn('standard')}>
                Try on Standard
              </Button>
            )}
          </>
        ) : code === 'model_unavailable' && run.tier !== 'standard' ? (
          <Button size="sm" disabled={actions.busy} onClick={() => actions.retryOn('standard')}>
            Retry on Standard
          </Button>
        ) : (
          <Button size="sm" disabled={actions.busy} onClick={actions.retry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}

/** The end of a run: what it cost, and Undo all while its edits are still on the piece. */
export function RunFooter({
  run,
  canUndo,
  onUndoAll,
  undoing,
}: {
  run: Run
  canUndo: boolean
  onUndoAll: () => void
  undoing: boolean
}) {
  const tokens = run.tokens.input + run.tokens.output + run.tokens.cacheRead + run.tokens.cacheWrite
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-fg-subtle tabular">
      {run.status === 'canceled' && <span className="font-sans">Stopped ·</span>}
      <span>{tokenCount(tokens)} tokens</span>
      <span aria-hidden>·</span>
      <span>{usd(run.costUsd)}</span>
      {run.tier && (
        <>
          <span aria-hidden>·</span>
          <span className="font-sans capitalize">{run.tier}</span>
        </>
      )}
      {canUndo && (
        <button
          type="button"
          disabled={undoing}
          onClick={onUndoAll}
          className="ml-auto inline-flex h-6 items-center gap-1 rounded-xs px-1.5 font-sans text-xs text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-50"
        >
          <Undo2 className="size-3" aria-hidden /> Undo all
        </button>
      )}
    </div>
  )
}

export function Thinking({ text, live }: { text: string; live?: boolean }) {
  return (
    <details className="group text-xs text-fg-subtle" open={live}>
      <summary
        className={cn('flex cursor-default list-none items-center gap-1.5 hover:text-fg-muted')}
      >
        <AiMark className={cn('size-2.5', live && 'animate-pulse')} />
        {live ? 'Thinking…' : 'Thought it through'}
      </summary>
      <p className="mt-1 ml-4 border-l border-line pl-2.5 whitespace-pre-wrap leading-5">{text}</p>
    </details>
  )
}
