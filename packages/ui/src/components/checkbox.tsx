import { Checkbox as Base } from '@base-ui/react/checkbox'
import { Check } from 'lucide-react'
import { cn } from '../cn'

export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
  id?: string
}

export function Checkbox({ checked, onChange, className, ...props }: CheckboxProps) {
  return (
    <Base.Root
      checked={checked}
      onCheckedChange={(c) => onChange(c)}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-xs bg-bg',
        'shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors duration-120',
        'data-checked:bg-ink data-checked:shadow-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Base.Indicator className="text-ink-fg data-unchecked:hidden">
        <Check className="size-3" strokeWidth={2.25} aria-hidden />
      </Base.Indicator>
    </Base.Root>
  )
}
