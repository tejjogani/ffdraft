import { NumberField as Base } from '@base-ui/react/number-field'
import { useId } from 'react'
import { cn } from '../cn'

export interface NumberFieldProps {
  label?: string
  value: number | null
  /** Live updates while typing a step or scrubbing — preview only. */
  onChange?: (value: number | null) => void
  /** Fires once on blur, Enter, a keyboard step or the end of a scrub: commit the edit here. */
  onCommit?: (value: number | null) => void
  unit?: string
  min?: number
  max?: number
  step?: number
  /** Decimal places shown; defaults from `step`. */
  precision?: number
  disabled?: boolean
  className?: string
  /** Compact inline variant for dense inspector rows. */
  size?: 'sm' | 'md'
  'aria-label'?: string
}

const decimalsOf = (step: number) => {
  const s = String(step)
  return s.includes('.') ? s.split('.')[1]!.length : 0
}

/**
 * The CAD workhorse. Drag the label to scrub, ↑/↓ to step (⇧ ×10, ⌥ ×0.1), type and press
 * Enter to commit. Digits are tabular mono so values don't jitter while scrubbing.
 */
export function NumberField({
  label,
  value,
  onChange,
  onCommit,
  unit,
  min,
  max,
  step = 1,
  precision,
  disabled,
  className,
  size = 'md',
  ...aria
}: NumberFieldProps) {
  const id = useId()
  const digits = precision ?? decimalsOf(step)
  return (
    <Base.Root
      id={id}
      value={value}
      onValueChange={(v) => onChange?.(v)}
      onValueCommitted={(v) => onCommit?.(v)}
      min={min}
      max={max}
      step={step}
      largeStep={step * 10}
      smallStep={step / 10}
      disabled={disabled}
      format={{ maximumFractionDigits: digits + 1, minimumFractionDigits: digits }}
      className={cn('group/num flex min-w-0 flex-col gap-1', className)}
    >
      <Base.Group
        className={cn(
          'flex min-w-0 items-center rounded-sm bg-bg shadow-[inset_0_0_0_1px_var(--line-strong)]',
          'transition-shadow duration-120 hover:shadow-[inset_0_0_0_1px_var(--fg-faint)]',
          'has-[input:focus-visible]:shadow-[inset_0_0_0_1px_var(--select),0_0_0_3px_var(--select-soft)]',
          'data-disabled:opacity-50',
          size === 'sm' ? 'h-7' : 'h-8',
        )}
      >
        {label && (
          <Base.ScrubArea
            direction="horizontal"
            pixelSensitivity={3}
            className="flex h-full shrink-0 cursor-ew-resize items-center pl-2.5 pr-1 select-none"
          >
            <label htmlFor={id} className="cursor-ew-resize text-xs text-fg-subtle">
              {label}
            </label>
            <Base.ScrubAreaCursor className="drop-shadow-sm">
              <ScrubCursor />
            </Base.ScrubAreaCursor>
          </Base.ScrubArea>
        )}
        <Base.Input
          aria-label={aria['aria-label'] ?? label}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className={cn(
            'h-full w-full min-w-0 bg-transparent text-right font-mono text-xs text-fg tabular outline-none',
            'focus-visible:outline-none',
            label ? 'pl-1' : 'pl-2.5',
            unit ? 'pr-1' : 'pr-2.5',
          )}
        />
        {unit && <span className="pr-2.5 font-mono text-2xs text-fg-subtle select-none">{unit}</span>}
      </Base.Group>
    </Base.Root>
  )
}

function ScrubCursor() {
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true">
      <path
        d="M5 1 0 6l5 5V7.5h12V11l5-5-5-5v3.5H5z"
        fill="var(--fg)"
        stroke="var(--bg)"
        strokeWidth="1"
      />
    </svg>
  )
}
