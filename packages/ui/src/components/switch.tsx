import { Switch as Base } from '@base-ui/react/switch'
import { cn } from '../cn'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
  id?: string
}

export function Switch({ checked, onChange, className, ...props }: SwitchProps) {
  return (
    <Base.Root
      checked={checked}
      onCheckedChange={(c) => onChange(c)}
      className={cn(
        'relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full p-0.5',
        'bg-bg-inset shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-150 ease-out',
        'data-checked:bg-ink data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Base.Thumb
        className={cn(
          'size-3.5 rounded-full bg-bg shadow-sm transition-transform duration-150 ease-out',
          'data-checked:translate-x-3.5 dark:data-checked:bg-ink-fg',
        )}
      />
    </Base.Root>
  )
}
