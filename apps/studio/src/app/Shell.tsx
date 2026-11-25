import { Button, EmptyState, Spinner } from '@pave/ui'
import { Outlet } from '@tanstack/react-router'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { Suspense } from 'react'
import { useUiTools } from '../features/assistant/ui-tools'
import { usePaveFileDrop } from '../features/pavefile'
import { PlanLimitCard } from '../features/plans/PlanLimitCard'
import { useBrowserTakes } from '../features/render/browser-takes'
import { useClientToolRelay } from '../lib/client-tools'
import { useShortcutListener } from '../lib/commands'
import { useServerEvents } from '../lib/events'
import { useRpc } from '../lib/query'
import { isUnauthorized } from '../lib/rpc'
import { SessionContext } from '../lib/session'
import { AuthScreen } from '../pages/auth/AuthScreen'
import { isDockedOpen, useAssistant } from '../stores/assistant'
import { useUI } from '../stores/ui'
import { AssistantDock, AssistantWindow } from './AssistantDock'
import { Palette } from './Palette'
import { Sidebar } from './Sidebar'
import { useGlobalCommands } from './useGlobalCommands'

/** Session gate: the sign-in screen on 401, a quiet error if the server is unreachable. */
export function Root() {
  const session = useRpc('session.get', {})
  useServerEvents(session.isSuccess)
  if (session.isPending)
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    )
  if (session.isError) {
    if (isUnauthorized(session.error)) return <AuthScreen />
    return (
      <div className="app-drag flex h-dvh items-center justify-center bg-bg-subtle">
        <EmptyState
          title="Can’t reach the studio"
          description={session.error.message}
          action={
            <Button className="app-no-drag" onClick={() => void session.refetch()}>
              Try again
            </Button>
          }
        />
      </div>
    )
  }
  return (
    <SessionContext value={session.data}>
      <MotionConfig reducedMotion="user">
        <Shell />
      </MotionConfig>
    </SessionContext>
  )
}

function Shell() {
  useGlobalCommands()
  useShortcutListener()
  // The assistant's client tools: this window answers its requests and serves ui.context/navigate.
  useClientToolRelay()
  useUiTools()
  // Without Blender, this window draws the person's (and their assistant's) preview takes.
  useBrowserTakes()
  // A .pave file dropped anywhere opens as a new piece.
  usePaveFileDrop()
  const collapsed = useUI((s) => s.sidebarCollapsed)
  const docked = useAssistant(isDockedOpen)
  return (
    // The muted backdrop is what the frosted sidebar sits on (on desktop, the window vibrancy).
    <div className="flex h-dvh overflow-hidden bg-bg-muted">
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="sidebar"
            className="h-full shrink-0"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Sidebar />
          </motion.div>
        )}
      </AnimatePresence>
      <main id="main" className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-bg">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </main>
      <AnimatePresence initial={false}>{docked && <AssistantDock key="dock" />}</AnimatePresence>
      {/* Floating or folded to a pill: over the work, not a column of it. */}
      <AssistantWindow />
      <Palette />
      <PlanLimitCard />
    </div>
  )
}
