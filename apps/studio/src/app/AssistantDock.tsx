import { AiMark, Chip, IconButton } from '@pave/ui'
import { useMatch } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { type KeyboardEvent, type PointerEvent, useRef } from 'react'
import { AssistantPanel } from '../features/assistant'
import { useRpc } from '../lib/query'
import { type AssistantContext, DOCK_MAX, DOCK_MIN, useAssistant } from '../stores/assistant'

/** The page the user is on, as assistant context. */
function useRouteContext(): AssistantContext {
  const piece = useMatch({ from: '/pieces/$id', shouldThrow: false })
  const board = useMatch({ from: '/ideas/$boardId', shouldThrow: false })
  return { pieceId: piece?.params.id ?? null, boardId: board?.params.boardId ?? null }
}

/**
 * The assistant's home: a right-hand dock that pushes content aside (never overlays it).
 * Resizable from its left edge by pointer or arrow keys.
 */
export function AssistantDock() {
  const width = useAssistant((s) => s.width)
  const setWidth = useAssistant((s) => s.setWidth)
  const close = useAssistant((s) => s.close)
  const context = useRouteContext()
  const piece = useRpc('pieces.get', { id: context.pieceId ?? '' }, { enabled: !!context.pieceId })
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
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-l border-line bg-bg"
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
        {piece.data && (
          <Chip outline className="app-no-drag max-w-40 truncate">
            {piece.data.title || 'Untitled'}
          </Chip>
        )}
        <IconButton
          icon={X}
          label="Close assistant"
          shortcut="mod+j"
          onClick={close}
          className="app-no-drag ml-auto"
        />
      </header>
      <div className="min-h-0 flex-1">
        <AssistantPanel context={context} />
      </div>
    </motion.aside>
  )
}
