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
  /** Footer actions, right-aligned; they stay in view while a long body scrolls. */
  footer?: ReactNode
  /**
   * `center` (default) is modal and dims the page behind. `end` docks at the inline end and is
   * not modal, for a dialog about something on screen that must stay in view and in reach (a
   * stone being replaced): the page keeps its pointer input, so the designer can orbit the
   * model while it is open, and only Escape or the dialog's own buttons close it.
   */
  placement?: 'center' | 'end'
  /**
   * Where a docked dialog sits, in px from the window's edges, when the caller knows a better
   * place than the default (the inspector column, say). `height` fills that place, so the
   * footer stays put while the body changes.
   */
  dock?: { top: number; right: number; width: number; height: number }
  className?: string
}

/** A dialog on the strong frosted surface (it holds reading); a body taller than the window scrolls between title and footer. */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  placement = 'center',
  dock,
  className,
}: DialogProps) {
  const docked = placement === 'end'
  return (
    <Base.Root
      open={open}
      onOpenChange={onOpenChange && ((o) => onOpenChange(o))}
      modal={!docked}
      disablePointerDismissal={docked}
    >
      {trigger && <Base.Trigger render={trigger} />}
      <Base.Portal>
        {!docked && <Base.Backdrop className={backdrop} />}
        <Base.Popup
          style={
            dock && { top: dock.top, right: dock.right, width: dock.width, height: dock.height }
          }
          className={cn(
            'glass-strong shadow-pop fixed z-50 flex flex-col rounded-xl pb-4 text-fg outline-none',
            docked
              ? 'top-20 right-4 max-h-[calc(100dvh-6rem)] w-[min(360px,calc(100vw-32px))]'
              : 'top-[18vh] left-1/2 max-h-[calc(82dvh-1rem)] w-[min(440px,calc(100vw-32px))] -translate-x-1/2',
            'transition-[opacity,scale] duration-180 ease-out data-starting-style:scale-[0.97] data-starting-style:opacity-0',
            'data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-120',
            className,
          )}
        >
          <div className="shrink-0 px-5 pt-5">
            <Base.Title className="text-base font-medium">{title}</Base.Title>
            {description && (
              <Base.Description className="mt-1 text-sm text-fg-muted">
                {description}
              </Base.Description>
            )}
          </div>
          {/* Padded inside the scroller so focus rings at its edges are not clipped. */}
          {children && (
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-1">
              {children}
            </div>
          )}
          {footer && (
            <div className="mt-auto flex shrink-0 justify-end gap-2 px-5 pt-4 pb-1">{footer}</div>
          )}
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
            'glass-strong shadow-pop fixed top-2 bottom-2 z-50 flex w-[min(440px,calc(100vw-16px))] flex-col rounded-xl text-fg outline-none',
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
