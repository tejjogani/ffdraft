import { Toast as Base } from '@base-ui/react/toast'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../cn'

/** Global toast manager, callable from anywhere (mutations, command handlers). */
const manager = Base.createToastManager()

export interface ToastOptions {
  title: ReactNode
  description?: ReactNode
  type?: 'info' | 'success' | 'error'
  action?: { label: string; onClick: () => void }
  timeout?: number
}

export const toast = (o: ToastOptions): string =>
  manager.add({
    title: o.title,
    description: o.description,
    type: o.type ?? 'info',
    timeout: o.timeout,
    priority: o.type === 'error' ? 'high' : 'low',
    actionProps: o.action ? { children: o.action.label, onClick: o.action.onClick } : undefined,
  })

toast.error = (title: ReactNode, description?: ReactNode) =>
  toast({ title, description, type: 'error' })
toast.success = (title: ReactNode, description?: ReactNode) =>
  toast({ title, description, type: 'success' })
toast.dismiss = (id: string) => manager.close(id)

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Base.Provider toastManager={manager} limit={4}>
      {children}
      <Base.Portal>
        <Base.Viewport className="fixed right-4 bottom-4 z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col-reverse gap-2 outline-none">
          <ToastList />
        </Base.Viewport>
      </Base.Portal>
    </Base.Provider>
  )
}

function ToastList() {
  const { toasts } = Base.useToastManager()
  return toasts.map((t) => (
    <Base.Root
      key={t.id}
      toast={t}
      className={cn(
        'glass shadow-pop relative flex items-start gap-2.5 rounded-lg p-3 pr-9 text-fg select-none',
        'transition-[opacity,translate] duration-180 ease-out',
        'translate-x-(--toast-swipe-movement-x) data-starting-style:translate-y-2 data-starting-style:opacity-0',
        'data-ending-style:opacity-0 data-limited:hidden',
      )}
    >
      {t.type === 'error' ? (
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      ) : t.type === 'success' ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
      ) : null}
      <div className="min-w-0 flex-1">
        <Base.Title className="text-sm font-medium" />
        <Base.Description className="mt-0.5 text-xs text-fg-muted empty:hidden" />
        {t.actionProps && (
          <Base.Action className="mt-2 -ml-1.5 h-6 rounded-xs px-1.5 text-xs font-medium text-fg hover:bg-bg-hover" />
        )}
      </div>
      <Base.Close
        aria-label="Dismiss"
        className="absolute top-2.5 right-2.5 inline-flex size-5 items-center justify-center rounded-xs text-fg-subtle hover:bg-bg-hover hover:text-fg"
      >
        <X className="size-3.5" aria-hidden />
      </Base.Close>
    </Base.Root>
  ))
}
