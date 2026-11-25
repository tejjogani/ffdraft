import { NumberField as Base } from '@base-ui/react/number-field'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { cn } from '../cn'

export interface NumberFieldProps {
  /** A short label inside the field (X, Y, Z) that scrubs when dragged. */
  label?: string
  /**
   * A form row's label that scrubs when dragged, for a label column beside the field. With it
   * the field renders two siblings — the label, then the input (with `leading` / `trailing`
   * around it) — for the caller's grid to place, e.g. `grid-cols-[40%_1fr]`.
   */
  rowLabel?: ReactNode
  /** Beside the input in a `rowLabel` layout: before it (a slider) and after it (a second field). */
  leading?: ReactNode
  trailing?: ReactNode
  value: number | null
  /** Live updates while typing, stepping or scrubbing — preview only. */
  onChange?: (value: number | null) => void
  /**
   * Fires once per edit: on blur, Enter or the end of a scrub; for arrow-key steps once the
   * keys have been idle for a moment, so a held arrow is one edit. Commit the edit here.
   */
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

/** Arrow-key steps closer together than this are one edit. */
const KEY_COMMIT_IDLE_MS = 600

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
  rowLabel,
  leading,
  trailing,
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
  const commit = useRef(onCommit)
  commit.current = onCommit
  // Escape after an edit puts back what the field held when it took focus, and goes no further:
  // a dialog around the field stays open with its other choices. On an untouched field Escape
  // is left to whatever is around it.
  const atFocus = useRef<number | null>(value)
  const current = useRef(value)
  current.current = value
  // Base UI keeps the typed text while the input has focus, whatever `value` says: putting the
  // old value back means a fresh field, focused again.
  const [generation, setGeneration] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (generation) input.current?.focus()
  }, [generation])
  const keyed = useRef<{ value: number | null; timer: ReturnType<typeof setTimeout> } | null>(null)
  const flush = () => {
    const k = keyed.current
    if (!k) return
    clearTimeout(k.timer)
    keyed.current = null
    // A committed value is the one Escape goes back to from here on.
    atFocus.current = k.value
    commit.current?.(k.value)
  }
  // An edit still waiting for its idle commit is committed, not lost, when the field goes away.
  // biome-ignore lint/correctness/useExhaustiveDependencies: flush reads refs only
  useEffect(() => flush, [])
  const group = (
    <Base.Group
      className={cn(
        'flex min-w-0 items-center rounded-sm bg-bg shadow-[inset_0_0_0_1px_var(--line-strong)]',
        'transition-shadow duration-120 hover:shadow-[inset_0_0_0_1px_var(--fg-faint)]',
        'has-[input:focus-visible]:shadow-[inset_0_0_0_1px_var(--select),0_0_0_3px_var(--select-soft)]',
        'data-disabled:opacity-50',
        size === 'sm' ? 'h-7' : 'h-8',
        rowLabel !== undefined && 'flex-1',
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
        ref={input}
        aria-label={aria['aria-label'] ?? label}
        onFocus={() => {
          atFocus.current = current.current
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape' && current.current !== atFocus.current) {
            e.preventDefault()
            e.stopPropagation()
            if (keyed.current) {
              clearTimeout(keyed.current.timer)
              keyed.current = null
            }
            onChange?.(atFocus.current)
            setGeneration((g) => g + 1)
          }
        }}
        onBlur={flush}
        className={cn(
          'h-full w-full min-w-0 bg-transparent text-right font-mono text-xs text-fg tabular outline-none',
          'focus-visible:outline-none',
          label ? 'pl-1' : 'pl-2.5',
          unit ? 'pr-1' : 'pr-2.5',
        )}
      />
      {unit && <span className="pr-2.5 font-mono text-2xs text-fg-subtle select-none">{unit}</span>}
    </Base.Group>
  )
  return (
    <Base.Root
      key={generation}
      id={id}
      value={value}
      onValueChange={(v) => onChange?.(v)}
      onValueCommitted={(v, details) => {
        if (details.reason === 'keyboard') {
          if (keyed.current) clearTimeout(keyed.current.timer)
          keyed.current = { value: v, timer: setTimeout(flush, KEY_COMMIT_IDLE_MS) }
          return
        }
        if (keyed.current) {
          clearTimeout(keyed.current.timer)
          keyed.current = null
        }
        atFocus.current = v
        onCommit?.(v)
      }}
      min={min}
      max={max}
      step={step}
      largeStep={step * 10}
      smallStep={step / 10}
      disabled={disabled}
      format={{ maximumFractionDigits: digits + 1, minimumFractionDigits: digits }}
      className={
        rowLabel === undefined ? cn('group/num flex min-w-0 flex-col gap-1', className) : 'contents'
      }
    >
      {rowLabel === undefined ? (
        group
      ) : (
        <>
          <Base.ScrubArea
            direction="horizontal"
            pixelSensitivity={3}
            className="flex min-w-0 cursor-ew-resize items-center self-stretch select-none"
          >
            <label htmlFor={id} className="min-w-0 cursor-ew-resize">
              {rowLabel}
            </label>
            <Base.ScrubAreaCursor className="drop-shadow-sm">
              <ScrubCursor />
            </Base.ScrubAreaCursor>
          </Base.ScrubArea>
          <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
            {leading}
            {group}
            {trailing}
          </div>
        </>
      )}
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
