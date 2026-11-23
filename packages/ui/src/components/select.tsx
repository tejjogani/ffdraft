import { Select as Base } from '@base-ui/react/select'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../cn'
import { floatingItem, floatingLabel, floatingSurface } from './floating'

export interface SelectOption<V extends string = string> {
  value: V
  label: string
  /** Leading visual, e.g. a <Swatch/>. */
  icon?: ReactNode
  hint?: string
}

export interface SelectGroup<V extends string = string> {
  label: string
  options: SelectOption<V>[]
}

export interface SelectProps<V extends string> {
  value: V | null
  onChange: (value: V) => void
  options: SelectOption<V>[] | SelectGroup<V>[]
  placeholder?: string
  disabled?: boolean
  /** `bare` renders as quiet inline text, for property rows. */
  variant?: 'default' | 'bare'
  className?: string
  'aria-label'?: string
}

const isGrouped = <V extends string>(o: SelectOption<V>[] | SelectGroup<V>[]): o is SelectGroup<V>[] =>
  o.length > 0 && 'options' in o[0]!

export function Select<V extends string>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  variant = 'default',
  className,
  ...aria
}: SelectProps<V>) {
  const groups = isGrouped(options) ? options : [{ label: '', options }]
  const flat = groups.flatMap((g) => g.options)
  const current = flat.find((o) => o.value === value)
  return (
    <Base.Root
      value={value}
      onValueChange={(v) => v !== null && onChange(v as V)}
      disabled={disabled}
      items={flat.map((o) => ({ value: o.value, label: o.label }))}
    >
      <Base.Trigger
        aria-label={aria['aria-label']}
        className={cn(
          'group/sel flex min-w-0 items-center gap-2 rounded-sm text-sm text-fg outline-none select-none',
          'transition-[background-color,box-shadow] duration-120',
          'focus-visible:shadow-[inset_0_0_0_1px_var(--select),0_0_0_3px_var(--select-soft)]',
          variant === 'default'
            ? 'h-8 justify-between bg-bg px-2.5 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--fg-faint)]'
            : 'h-7 px-1.5 hover:bg-bg-hover data-popup-open:bg-bg-active',
          'data-disabled:opacity-50',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {current?.icon}
          <span className={cn('truncate', !current && 'text-fg-subtle')}>
            {current?.label ?? placeholder}
          </span>
        </span>
        {variant === 'default' && (
          <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        )}
      </Base.Trigger>
      <Base.Portal>
        <Base.Positioner sideOffset={4} alignItemWithTrigger={false} align="start" className="z-50">
          <Base.Popup
            className={cn(
              floatingSurface,
              'max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto p-1',
            )}
          >
            <Base.List>
              {groups.map((g, gi) => (
                <Base.Group key={g.label || gi}>
                  {g.label && <Base.GroupLabel className={floatingLabel}>{g.label}</Base.GroupLabel>}
                  {g.options.map((o) => (
                    <Base.Item key={o.value} value={o.value} className={cn(floatingItem, 'pr-7 relative')}>
                      {o.icon}
                      <Base.ItemText className="truncate">{o.label}</Base.ItemText>
                      {o.hint && <span className="ml-auto pl-4 text-xs text-fg-subtle tabular">{o.hint}</span>}
                      <Base.ItemIndicator className="absolute right-2">
                        <Check aria-hidden />
                      </Base.ItemIndicator>
                    </Base.Item>
                  ))}
                </Base.Group>
              ))}
            </Base.List>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}
