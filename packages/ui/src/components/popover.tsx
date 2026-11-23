import { Popover as Base } from '@base-ui/react/popover'
import type { ReactElement, ReactNode } from 'react'
import { cn } from '../cn'
import { floatingSurface } from './floating'

export interface PopoverProps {
  trigger: ReactElement
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  /** Accessible title, rendered visually hidden unless `showTitle`. */
  title?: string
}

export function Popover({
  trigger,
  children,
  side = 'bottom',
  align = 'start',
  open,
  onOpenChange,
  className,
  title,
}: PopoverProps) {
  return (
    <Base.Root open={open} onOpenChange={onOpenChange && ((o) => onOpenChange(o))}>
      <Base.Trigger render={trigger} />
      <Base.Portal>
        <Base.Positioner side={side} align={align} sideOffset={6} className="z-50">
          <Base.Popup className={cn(floatingSurface, 'p-3', className)}>
            {title && <Base.Title className="sr-only">{title}</Base.Title>}
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}

export const PopoverClose = Base.Close
