import { LucideProvider } from 'lucide-react'
import type { ReactNode } from 'react'
import { ToastProvider } from './components/toast'
import { TooltipProvider } from './components/tooltip'

/** App-level providers for the component system: icon defaults, tooltip timing, toasts. */
export function PaveUIProvider({ children }: { children: ReactNode }) {
  return (
    <LucideProvider size={16} strokeWidth={1.5}>
      <TooltipProvider delay={500} closeDelay={0}>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </LucideProvider>
  )
}
