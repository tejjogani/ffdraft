import { type ReactNode, useId } from 'react'
import { cn } from '../cn'

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  /** The control; receives nothing — wire `id` yourself via the render form if needed. */
  children: ReactNode | ((id: string) => ReactNode)
  /** `row` puts label and control side by side (inspector rows); `stack` puts the label above. */
  layout?: 'row' | 'stack'
  className?: string
}

export function Field({ label, hint, children, layout = 'stack', className }: FieldProps) {
  const id = useId()
  const control = typeof children === 'function' ? children(id) : children
  if (layout === 'row')
    return (
      <div className={cn('grid min-h-8 grid-cols-[minmax(96px,34%)_1fr] items-center gap-3', className)}>
        <label htmlFor={id} className="truncate text-sm text-fg-muted">
          {label}
        </label>
        <div className="min-w-0">
          {control}
          {hint && <p className="mt-1 text-xs text-fg-subtle">{hint}</p>}
        </div>
      </div>
    )
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      {control}
      {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
    </div>
  )
}
