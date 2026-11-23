import { Slider as Base } from '@base-ui/react/slider'
import { cn } from '../cn'

export interface SliderProps {
  value: number
  onChange?: (value: number) => void
  onCommit?: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export function Slider({ value, onChange, onCommit, className, ...props }: SliderProps) {
  return (
    <Base.Root
      value={value}
      onValueChange={(v) => onChange?.(v as number)}
      onValueCommitted={(v) => onCommit?.(v as number)}
      className={cn('flex h-5 w-full items-center data-disabled:opacity-50', className)}
      {...props}
    >
      <Base.Control className="flex h-5 w-full touch-none items-center select-none">
        <Base.Track className="h-1 w-full rounded-full bg-bg-inset">
          <Base.Indicator className="rounded-full bg-fg-muted" />
          <Base.Thumb
            aria-label={props['aria-label']}
            className={cn(
              'size-3.5 rounded-full bg-bg shadow-[0_0_0_1px_var(--line-strong),0_1px_3px_rgba(0,0,0,0.15)]',
              'transition-[scale] duration-120 data-dragging:scale-110',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-select',
            )}
          />
        </Base.Track>
      </Base.Control>
    </Base.Root>
  )
}
