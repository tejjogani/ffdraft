import { Dialog as Base } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { cn } from '../cn'
import { IconButton } from './button'

const backdrop =
  'fixed inset-0 z-50 bg-[rgba(20,18,15,0.18)] dark:bg-black/45 transition-opacity duration-180 ease-out ' +
  'data-starting-style:opacity-0 data-ending-style:opacity-0'

export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Optional trigger element; omit for controlled dialogs. */
  trigger?: ReactElement
  title: string
  description?: ReactNode
  children?: ReactNode
  /** Footer actions, right-aligned. */
  footer?: ReactNode
  className?: string
}

/** Centred modal on a frosted surface. */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  return (
    <Base.Root open={open} onOpenChange={onOpenChange && ((o) => onOpenChange(o))}>
      {trigger && <Base.Trigger render={trigger} />}
      <Base.Portal>
        <Base.Backdrop className={backdrop} />
        <Base.Popup
          className={cn(
            'glass shadow-pop fixed top-[18vh] left-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 rounded-xl p-5 text-fg outline-none',
            'transition-[opacity,scale] duration-180 ease-out data-starting-style:scale-[0.97] data-starting-style:opacity-0',
            'data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-120',
            className,
          )}
        >
          <Base.Title className="text-base font-medium">{title}</Base.Title>
          {description && (
            <Base.Description className="mt-1 text-sm text-fg-muted">
              {description}
            </Base.Description>
          )}
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  )
}

export const DialogClose = Base.Close

export interface SheetProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactElement
  title: string
  children: ReactNode
  side?: 'right' | 'left'
  className?: string
}

/** A full-height side panel over the content, for detail views that don't deserve a page. */
export function Sheet({
  open,
  onOpenChange,
  trigger,
  title,
  children,
  side = 'right',
  className,
}: SheetProps) {
  return (
    <Base.Root open={open} onOpenChange={onOpenChange && ((o) => onOpenChange(o))}>
      {trigger && <Base.Trigger render={trigger} />}
      <Base.Portal>
        <Base.Backdrop className={backdrop} />
        <Base.Popup
          className={cn(
            'glass shadow-pop fixed top-2 bottom-2 z-50 flex w-[min(440px,calc(100vw-16px))] flex-col rounded-xl text-fg outline-none',
            'transition-[opacity,translate] duration-180 ease-out data-starting-style:opacity-0 data-ending-style:opacity-0',
            side === 'right'
              ? 'right-2 data-starting-style:translate-x-2 data-ending-style:translate-x-2'
              : 'left-2 data-starting-style:-translate-x-2 data-ending-style:-translate-x-2',
            className,
          )}
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-glass-line pr-2 pl-4">
            <Base.Title className="text-sm font-medium">{title}</Base.Title>
            <Base.Close render={<IconButton icon={X} label="Close" tooltip={false} />} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  )
}
