/**
 * Where the assistant lives. Three forms, one conversation:
 *
 * - docked: a column snapped into the right-hand sidebar that pushes the page aside;
 * - floating: a frosted-glass window over the work, moved by its title bar, resized from its
 *   edges, and snapped back into the sidebar by dragging it to the right edge;
 * - collapsed: a small pill in the corner that shows a running job's progress.
 *
 * Where it was (and its size) is remembered per browser (stores/assistant). The conversation
 * follows the piece: opening another piece shows that piece's latest conversation.
 */
import { AiMark, cn, IconButton } from '@pave/ui'
import { useMatch, useRouterState } from '@tanstack/react-router'
import { History, Minus, PanelRight, PictureInPicture2, SquarePen, X } from 'lucide-react'
import { motion } from 'motion/react'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { AssistantPanel } from '../features/assistant'
import { pillSummary, stageOfPath } from '../features/assistant/jobs/status'
import { useLiveRun } from '../features/assistant/jobs/useJob'
import { defaultRect } from '../lib/float-window'
import { useRpc } from '../lib/query'
import { useSession } from '../lib/session'
import { type AssistantContext, DOCK_MAX, DOCK_MIN, useAssistant } from '../stores/assistant'

/** The floating window's first size and its smallest. */
const FLOAT_SIZE = { w: 400, h: 620 }
const FLOAT_LIMITS = { minW: 320, minH: 360 }

/** The page the user is on, as assistant context. */
function useRouteContext(): AssistantContext {
  const piece = useMatch({ from: '/pieces/$id', shouldThrow: false })
  const board = useMatch({ from: '/ideas/$boardId', shouldThrow: false })
  return { pieceId: piece?.params.id ?? null, boardId: board?.params.boardId ?? null }
}

/**
 * Opening another piece brings up that piece's latest conversation (or a new one), unless the
 * conversation shown is already about it or about no piece at all (a chat started on Home that
 * is making this piece).
 */
function useFollowPiece(pieceId: string | null | undefined) {
  const threads = useRpc(
    'threads.list',
    { pieceId: pieceId ?? '', limit: 1 },
    { enabled: !!pieceId },
  )
  const last = useRef(pieceId)
  useEffect(() => {
    if (!pieceId || last.current === pieceId || !threads.data) return
    last.current = pieceId
    const s = useAssistant.getState()
    if (!s.activeThreadId || !s.threadPieceId || s.threadPieceId === pieceId) return
    s.openThread(threads.data[0]?.id ?? null)
  }, [pieceId, threads.data])
}

/** The assistant in whichever form it is in; nothing when closed. */
export function AssistantWindow() {
  const isOpen = useAssistant((s) => s.isOpen)
  const layout = useAssistant((s) => s.layout)
  const collapsed = useAssistant((s) => s.collapsed)
  const context = useRouteContext()
  useFollowPiece(context.pieceId)
  if (!isOpen) return null
  if (collapsed) return <AssistantPill />
  if (layout === 'floating') return <AssistantFloating context={context} />
  return null
}

/** Title-bar buttons shared by the docked and floating forms. */
function WindowActions({ docked }: { docked: boolean }) {
  const showThreads = useAssistant((s) => s.showThreads)
  const setShowThreads = useAssistant((s) => s.setShowThreads)
  const openThread = useAssistant((s) => s.openThread)
  const close = useAssistant((s) => s.close)
  const setLayout = useAssistant((s) => s.setLayout)
  const setCollapsed = useAssistant((s) => s.setCollapsed)
  const available = useSession().capabilities.assistant
  return (
    <>
      {available && (
        <>
          <IconButton
            icon={History}
            label={showThreads ? 'Back to the conversation' : 'Conversations'}
            aria-pressed={showThreads}
            onClick={() => setShowThreads(!showThreads)}
          />
          <IconButton icon={SquarePen} label="New conversation" onClick={() => openThread(null)} />
        </>
      )}
      {docked ? (
        <IconButton
          icon={PictureInPicture2}
          label="Pop out as a floating window"
          className="max-sm:hidden"
          onClick={() => {
            const s = useAssistant.getState()
            setLayout(
              'floating',
              s.rect ??
                defaultRect(
                  { w: window.innerWidth, h: window.innerHeight },
                  FLOAT_SIZE,
                  FLOAT_LIMITS,
                ),
            )
          }}
        />
      ) : (
        <IconButton
          icon={PanelRight}
          label="Dock in the sidebar"
          className="max-sm:hidden"
          onClick={() => setLayout('docked')}
        />
      )}
      <IconButton icon={Minus} label="Collapse to a pill" onClick={() => setCollapsed(true)} />
      <IconButton icon={X} label="Close assistant" shortcut="mod+j" onClick={close} />
    </>
  )
}

function AssistantFloating({ context }: { context: AssistantContext }) {
  const rect = useAssistant((s) => s.rect)
  const setRect = useAssistant((s) => s.setRect)
  const setLayout = useAssistant((s) => s.setLayout)
  const stage = useRouterState({ select: (r) => stageOfPath(r.location.pathname) })
  return (
    <FloatingWindow
      label="Assistant"
      layer="z-40"
      rect={rect}
      defaultSize={FLOAT_SIZE}
      limits={FLOAT_LIMITS}
      onRect={setRect}
      onSnap={() => setLayout('docked')}
      title={
        <>
          <AiMark className="size-3.5" />
          <span className="truncate text-sm font-medium">Assistant</span>
        </>
      }
      actions={<WindowActions docked={false} />}
    >
      <AssistantPanel context={context} stage={stage} />
    </FloatingWindow>
  )
}

/**
 * The assistant folded away: one pill in the corner. While a job runs it shows the job, its
 * step and a progress bar, so the person can follow it with the window out of the way.
 */
function AssistantPill() {
  const threadId = useAssistant((s) => s.activeThreadId)
  const setCollapsed = useAssistant((s) => s.setCollapsed)
  const close = useAssistant((s) => s.close)
  const thread = useRpc('threads.get', { id: threadId ?? '' }, { enabled: !!threadId })
  const { run } = useLiveRun(thread.data?.run ?? null)
  const sum = pillSummary(run)
  const label = `${sum.title}${sum.detail ? `: ${sum.detail}` : ''}. Open the assistant`
  return (
    <div
      data-assistant-pill
      className="glass fixed right-4 bottom-4 z-40 flex max-w-[min(360px,calc(100vw-32px))] items-center overflow-hidden rounded-full shadow-pop"
    >
      <button
        type="button"
        aria-label={label}
        title="Open the assistant (mod+j)"
        onClick={() => setCollapsed(false)}
        className="relative flex min-w-0 items-center gap-2 py-2 pr-2 pl-3.5 text-left"
      >
        <AiMark className={cn('size-3.5 shrink-0', sum.working && 'animate-pulse')} />
        <span className="shrink-0 text-sm font-medium">{sum.title}</span>
        {sum.detail && <span className="min-w-0 truncate text-sm text-fg-muted">{sum.detail}</span>}
        {sum.progress !== null && (
          <span
            aria-hidden
            className="absolute inset-x-3.5 bottom-1 h-0.5 overflow-hidden rounded-full bg-line"
          >
            <span
              className="block h-full rounded-full bg-[var(--ai-a)] transition-[width] duration-500"
              style={{ width: `${Math.round(sum.progress * 100)}%` }}
            />
          </span>
        )}
      </button>
      <IconButton icon={X} label="Close assistant" size="sm" className="mr-1.5" onClick={close} />
    </div>
  )
}

/**
 * The docked form: a right-hand column that pushes content aside (never overlays it).
 * Resizable from its left edge by pointer or arrow keys.
 */
export function AssistantDock() {
  const width = useAssistant((s) => s.width)
  const setWidth = useAssistant((s) => s.setWidth)
  const context = useRouteContext()
  const stage = useRouterState({ select: (r) => stageOfPath(r.location.pathname) })
  const drag = useRef<{ x: number; w: number } | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: width }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setWidth(drag.current.w + (drag.current.x - e.clientX))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10
    if (e.key === 'ArrowLeft') setWidth(width + step)
    else if (e.key === 'ArrowRight') setWidth(width - step)
    else return
    e.preventDefault()
  }

  return (
    <motion.aside
      aria-label="Assistant"
      data-assistant-docked
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-l border-line bg-bg max-sm:fixed max-sm:inset-0 max-sm:z-40 max-sm:w-full! max-sm:border-l-0"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a resizable splitter */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant"
        aria-valuemin={DOCK_MIN}
        aria-valuemax={DOCK_MAX}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null
        }}
        onKeyDown={onKeyDown}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1 after:w-px after:transition-colors hover:after:bg-line-strong focus-visible:after:bg-select"
      />
      <header className="app-drag flex h-11 shrink-0 items-center gap-2 pr-[calc(8px+var(--chrome-right))] pl-4">
        <AiMark className="size-3.5" />
        <span className="text-sm font-medium">Assistant</span>
        <span className="app-no-drag ml-auto flex items-center">
          <WindowActions docked />
        </span>
      </header>
      <div className="min-h-0 flex-1">
        <AssistantPanel context={context} stage={stage} />
      </div>
    </motion.aside>
  )
}
