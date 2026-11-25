/**
 * How a take that is still rendering reads: a ring that fills with its progress, the time left
 * in words, and Cancel. Used on the Render tab's tiles and inline in the assistant's dock.
 */
import { machineTime } from '@pave/render'
import type { RenderJob } from '@pave/schema'
import { Button, cn } from '@pave/ui'
import { useEffect, useState } from 'react'
import { secondsLeft } from './shots'

export function Ring({ progress, className }: { progress: number; className?: string }) {
  const r = 15
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, progress))
  return (
    <svg viewBox="0 0 36 36" className={cn('size-9 -rotate-90', className)} aria-hidden>
      <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="stroke-line" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p)}
        className="stroke-fg transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
      />
    </svg>
  )
}

/** Re-renders every few seconds so the time left counts down between progress events. */
function useNow(everyMs = 2_000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

export function TakeProgress({
  take,
  estimate,
  onCancel,
  canceling,
  compact,
}: {
  take: RenderJob
  /** The take's estimated machine time in seconds, when known. */
  estimate: number | null
  onCancel?: () => void
  canceling?: boolean
  compact?: boolean
}) {
  const now = useNow()
  const left = secondsLeft(take, estimate, now)
  const pct = Math.round(take.progress * 100)
  const what =
    take.status === 'queued'
      ? take.engine === 'browser'
        ? 'Waiting for a Pavé window to draw it'
        : 'Queued'
      : `Rendering ${pct}%`
  return (
    <div
      className={cn('flex items-center gap-2.5', compact ? 'text-xs' : 'text-sm')}
      role="status"
      aria-label={`${what}${left ? `, ${machineTime(left)} left` : ''}`}
    >
      <Ring progress={take.status === 'queued' ? 0 : take.progress} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{what}</p>
        {left !== null && (
          <p className="truncate font-mono text-2xs text-fg-subtle tabular">
            {machineTime(left)} left
          </p>
        )}
      </div>
      {onCancel && (
        <Button size="sm" variant="ghost" disabled={canceling} onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  )
}
