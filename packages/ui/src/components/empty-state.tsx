import type { ReactNode } from 'react'
import { cn } from '../cn'

export interface EmptyStateProps {
  /** Serif headline. */
  title: string
  /** One line of help. */
  description?: ReactNode
  /** One action. */
  action?: ReactNode
  /** Optional quiet illustration above the headline. */
  visual?: ReactNode
  className?: string
}

export function EmptyState({ title, description, action, visual, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      {visual && <div className="mb-5 text-fg-faint">{visual}</div>}
      <h3 className="font-serif text-[26px] leading-8 text-fg">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-fg-muted text-pretty">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export interface InlineErrorProps {
  message: string
  onRetry?: () => void
  className?: string
}

/** Errors are quiet: one muted line with a retry, never a red banner. */
export function InlineError({ message, onRetry, className }: InlineErrorProps) {
  return (
    <div role="alert" className={cn('flex items-center gap-2 py-3 text-sm text-fg-muted', className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-danger" aria-hidden />
      <span className="min-w-0 truncate">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xs px-1 font-medium text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg"
        >
          Retry
        </button>
      )}
    </div>
  )
}
