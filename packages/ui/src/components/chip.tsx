import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../cn'

export type ChipTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'select'

const tones: Record<ChipTone, string> = {
  neutral: 'bg-bg-muted text-fg-muted',
  ok: 'bg-[color-mix(in_oklab,var(--ok)_12%,transparent)] text-ok',
  warn: 'bg-[color-mix(in_oklab,var(--warn)_13%,transparent)] text-warn',
  danger: 'bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-danger',
  select: 'bg-select-soft text-select',
}

export interface ChipProps extends ComponentProps<'span'> {
  tone?: ChipTone
  icon?: ReactNode
  /** Outlined instead of filled — for properties, not statuses. */
  outline?: boolean
}

/** A compact label. Rounded-sm, not a pill: the interface avoids pill-everything. */
export function Chip({ tone = 'neutral', icon, outline, className, children, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-xs px-1.5 text-xs font-medium whitespace-nowrap select-none [&_svg]:size-3',
        outline ? 'text-fg-muted shadow-[inset_0_0_0_1px_var(--line-strong)]' : tones[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  )
}

/** Small count badge. */
export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-xs bg-bg-muted px-1 text-2xs font-medium text-fg-muted tabular',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** The AI mark: a small four-point spark filled with the reserved shimmer. */
export function AiMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('ai-gradient inline-block size-3 shrink-0 [mask:var(--ai-spark)_center/contain_no-repeat]', className)} />
  )
}

/** Marks agent-made things. The shimmer lives in the 1 px border, never behind the text. */
export function AiChip({ children = 'AI', className }: { children?: ReactNode; className?: string }) {
  return (
    <span className={cn('ai-gradient inline-flex shrink-0 rounded-xs p-px select-none', className)}>
      <span className="inline-flex h-4.5 items-center gap-1 rounded-[3px] bg-bg px-1.5 text-2xs font-medium text-fg">
        <AiMark className="size-2.5" />
        {children}
      </span>
    </span>
  )
}

export interface ProgressRingProps {
  /** Steps completed. `step === of` draws a filled check. */
  step: number
  of: number
  className?: string
  /** Dashed outline for "not started". */
  dashed?: boolean
}

/** A Linear-style status glyph: a ring that fills as a piece moves through its stages. */
export function ProgressRing({ step, of, className, dashed }: ProgressRingProps) {
  const r = 5
  const c = 2 * Math.PI * r
  const done = step >= of
  return (
    <svg viewBox="0 0 14 14" className={cn('size-3.5 shrink-0', className)} aria-hidden>
      {done ? (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M4.4 7.2 6.2 9l3.4-3.6" fill="none" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle
            cx="7"
            cy="7"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeDasharray={dashed ? '1.6 1.6' : undefined}
            opacity={dashed ? 0.8 : 1}
          />
          {step > 0 && (
            <circle
              cx="7"
              cy="7"
              r={r / 2}
              fill="none"
              stroke="currentColor"
              strokeWidth={r}
              strokeDasharray={`${(c / 2) * (step / of)} ${c}`}
              transform="rotate(-90 7 7)"
            />
          )}
        </>
      )}
    </svg>
  )
}
