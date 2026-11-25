/** This month's use of each allowance, as Settings, Plan and the Upgrade screen show it. */
import type { AllowanceStatus } from '@pave/schema'
import { cn } from '@pave/ui'

export function AllowanceMeter({ a }: { a: AllowanceStatus }) {
  const unlimited = a.limit === null
  const share = unlimited ? 0 : a.limit! > 0 ? Math.min(1, a.used / a.limit!) : 1
  const out = !unlimited && a.left === 0
  return (
    <div className="flex flex-col gap-1.5 py-3.5">
      <div className="flex items-baseline justify-between gap-6">
        <span className="text-sm">{a.label}</span>
        <span className="font-mono text-xs tabular text-fg-muted">
          {unlimited ? `${a.used} this month · unlimited` : `${a.used} of ${a.limit} used`}
        </span>
      </div>
      {!unlimited && (
        // The numbers above say it in words; the bar is for the eye.
        <div className="h-1 overflow-hidden rounded-full bg-bg-muted" aria-hidden>
          <div
            className={cn('h-full rounded-full', out ? 'bg-warn' : 'bg-fg-muted')}
            style={{ width: `${share * 100}%` }}
          />
        </div>
      )}
      <span className="text-xs text-fg-subtle">
        {unlimited
          ? `Fair use up to ${a.ceiling} a month.`
          : out
            ? 'None left this month.'
            : `${a.left} left this month.`}
      </span>
    </div>
  )
}
