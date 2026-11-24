import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../cn'

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  /** With an icon the label becomes the accessible name only. */
  icon?: LucideIcon
}

export interface SegmentedProps<V extends string> {
  value: V
  onChange: (value: V) => void
  options: SegmentedOption<V>[]
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/** A single-choice segmented control on an inset track. */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  size = 'sm',
  disabled,
  className,
  ...aria
}: SegmentedProps<V>) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(v) => {
        const next = v[0]
        if (next !== undefined) onChange(next as V)
      }}
      aria-label={aria['aria-label']}
      disabled={disabled}
      className={cn(
        'inline-flex shrink-0 items-center gap-px rounded-sm bg-bg-muted p-0.5 data-disabled:opacity-50',
        className,
      )}
    >
      {options.map(({ value: v, label, icon: Icon }) => (
        <Toggle
          key={v}
          value={v}
          aria-label={Icon ? label : undefined}
          title={Icon ? label : undefined}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-xs text-xs font-medium text-fg-muted select-none',
            'transition-[background-color,color,box-shadow] duration-120 ease-out hover:text-fg',
            'data-disabled:pointer-events-none',
            'data-pressed:bg-bg data-pressed:text-fg data-pressed:shadow-[0_0_0_1px_var(--line),0_1px_2px_rgba(0,0,0,0.06)]',
            'focus-visible:outline-offset-0 [&_svg]:size-3.5',
            size === 'sm' ? 'h-6 px-2' : 'h-7 px-2.5',
            Icon && (size === 'sm' ? 'w-7 px-0' : 'w-8 px-0'),
          )}
        >
          {Icon ? <Icon aria-hidden /> : label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
