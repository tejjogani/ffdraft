import { cn } from '@pave/ui'
import type { ReactNode } from 'react'

/** A row of labelled figures on hairline-separated cells. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-md bg-line', className)}>
      {children}
    </dl>
  )
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-bg px-3 py-2.5">
      <dt className="text-2xs text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm tabular">{value}</dd>
    </div>
  )
}
