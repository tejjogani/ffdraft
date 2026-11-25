import { Button, EmptyState, Skeleton } from '@pave/ui'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { Suspense, useEffect } from 'react'
import { useUiTools } from '../features/assistant/ui-tools'
import { usePaveFileDrop } from '../features/pavefile'
import { PlanLimitCard } from '../features/plans/PlanLimitCard'
import { useBrowserTakes } from '../features/render/browser-takes'
import { useClientToolRelay } from '../lib/client-tools'
import { useShortcutListener } from '../lib/commands'
import { useServerEvents } from '../lib/events'
import { useRpc } from '../lib/query'
import { useNarrow } from '../lib/narrow'
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
  if (session.isPending) return <BootSkeleton />
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
  const narrow = useNarrow()
  const docked = useAssistant(isDockedOpen)
  return (
    // The muted backdrop is what the frosted sidebar sits on (on desktop, the window vibrancy).
    <div className="flex h-dvh overflow-hidden bg-bg-muted">
      {narrow && <MobileNav />}
      <AnimatePresence initial={false}>
        {!collapsed && !narrow && (
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

/**
 * The sidebar on a phone: a drawer over the page, opened from the header's menu button and
 * closed by the scrim, Escape, or going anywhere.
 */
function MobileNav() {
  const open = useUI((s) => s.mobileNavOpen)
  const setOpen = useUI((s) => s.setMobileNav)
  const path = useRouterState({ select: (s) => s.location.pathname })
  // Following a link is the end of using the drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on every path change
  useEffect(() => setOpen(false), [path, setOpen])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="mobile-nav"
          className="fixed inset-0 z-50 flex"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <motion.div
            className="h-full shadow-pop"
            initial={{ x: -24 }}
            animate={{ x: 0 }}
            exit={{ x: -24 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Sidebar drawer />
          </motion.div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="min-w-0 flex-1 bg-[rgba(20,18,15,0.18)] dark:bg-black/45"
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The first paint while the session loads: the shell's shape, not a spinner. */
function BootSkeleton() {
  return (
    <div
      className="flex h-dvh bg-bg-muted"
      role="status"
      aria-busy="true"
      aria-label="Loading the studio"
    >
      <div className="hidden w-[248px] shrink-0 flex-col gap-2 px-3 pt-4 md:flex">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-4 h-5 w-40" />
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-5 w-28" />
      </div>
      <div className="flex-1 bg-bg px-6 pt-24 sm:px-12">
        <div className="mx-auto max-w-[880px]">
          <Skeleton className="h-10 w-2/3 max-w-md" />
          <Skeleton className="mt-6 h-28 w-full" />
        </div>
      </div>
    </div>
  )
}
