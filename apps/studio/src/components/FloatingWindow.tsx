/**
 * A floating glass window over the work: moved by its title bar (or the arrow keys on it),
 * resized from any edge or corner, kept on screen when the browser shrinks, and snapped into the
 * right-hand sidebar by dragging it to the right edge. Used by the assistant and the reference
 * window, which own where it is (their stores remember it); the geometry is lib/float-window.
 *
 * On a phone there is no room to float: the window fills the screen instead.
 */
import { cn } from '@pave/ui'
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  clampRect,
  defaultRect,
  type Edge,
  type Limits,
  moveRect,
  nudge,
  type Rect,
  resizeRect,
  type Size,
  snapsToSide,
} from '../lib/float-window'

/** Below this viewport width a floating window fills the screen. */
export const PHONE_PX = 640

const readViewport = (): Size => ({ w: window.innerWidth, h: window.innerHeight })

function useViewport(): Size {
  const read = readViewport
  const [view, setView] = useState<Size>(read)
  useEffect(() => {
    const on = () => setView(readViewport())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return view
}

const HANDLES: { edge: Edge; className: string }[] = [
  { edge: 'n', className: 'inset-x-3 -top-1 h-2 cursor-ns-resize' },
  { edge: 's', className: 'inset-x-3 -bottom-1 h-2 cursor-ns-resize' },
  { edge: 'w', className: 'inset-y-3 -left-1 w-2 cursor-ew-resize' },
  { edge: 'e', className: 'inset-y-3 -right-1 w-2 cursor-ew-resize' },
  { edge: 'nw', className: '-top-1 -left-1 size-3 cursor-nwse-resize' },
  { edge: 'se', className: '-right-1 -bottom-1 size-3 cursor-nwse-resize' },
  { edge: 'ne', className: '-top-1 -right-1 size-3 cursor-nesw-resize' },
  { edge: 'sw', className: '-bottom-1 -left-1 size-3 cursor-nesw-resize' },
]

/** Pointer-downs on these start no drag: the title bar's own buttons and fields. */
const INTERACTIVE = 'button, a, input, textarea, select, [role="tab"], [role="menuitem"]'

export function FloatingWindow({
  label,
  title,
  actions,
  rect,
  defaultSize,
  limits,
  onRect,
  onSnap,
  snapHint = 'Release to dock it in the sidebar',
  snapWidth = 380,
  className,
  children,
  layer = 'z-40',
}: {
  /** The window's accessible name. */
  label: string
  /** The title bar's left side. */
  title: ReactNode
  /** The title bar's buttons. */
  actions?: ReactNode
  rect: Rect | null
  defaultSize: Size
  limits: Limits
  /** The window moved or resized (on release, not on every pointer move). */
  onRect: (rect: Rect) => void
  /** Dragged onto the right edge: dock it. Omit for a window that never docks. */
  onSnap?: () => void
  snapHint?: string
  /** The sidebar width the snap preview shows. */
  snapWidth?: number
  className?: string
  children: ReactNode
  /** Stacking class, so two floating windows keep a fixed order. */
  layer?: string
}) {
  const view = useViewport()
  const phone = view.w < PHONE_PX
  const settled = clampRect(rect ?? defaultRect(view, defaultSize, limits), view, limits)
  // While a drag is under way the window follows locally; the owner hears once, on release.
  const [live, setLive] = useState<Rect | null>(null)
  const [snapping, setSnapping] = useState(false)
  const gesture = useRef<{ kind: 'move' | Edge; x: number; y: number; start: Rect } | null>(null)
  const shown = live ?? settled

  const begin = (kind: 'move' | Edge) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    if (kind === 'move' && (e.target as HTMLElement).closest(INTERACTIVE)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    gesture.current = { kind, x: e.clientX, y: e.clientY, start: settled }
    e.preventDefault()
  }
  const move = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (g.kind === 'move') {
      setLive(moveRect(g.start, dx, dy, view, limits))
      setSnapping(!!onSnap && snapsToSide(e.clientX, view))
    } else setLive(resizeRect(g.start, g.kind, dx, dy, view, limits))
  }
  const end = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    if (g.kind === 'move' && onSnap && snapsToSide(e.clientX, view)) onSnap()
    else if (live) onRect(live)
    setLive(null)
    setSnapping(false)
  }
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return
    const next = nudge(settled, e.key, e.shiftKey, view, limits)
    if (!next) return
    e.preventDefault()
    onRect(next)
  }

  return createPortal(
    <>
      {snapping && (
        <div
          aria-hidden
          style={{ width: snapWidth }}
          className={cn(
            'pointer-events-none fixed inset-y-2 right-2 flex items-center justify-center rounded-xl border border-select bg-select-soft text-xs font-medium text-select',
            layer,
          )}
        >
          {snapHint}
        </div>
      )}
      <section
        aria-label={label}
        data-floating-window={label}
        style={phone ? undefined : { left: shown.x, top: shown.y, width: shown.w, height: shown.h }}
        className={cn(
          // Frosted glass, but strong: a window holds reading, so the work behind it may only
          // tint it (the body adds a light wash; where blur is missing it still reads).
          'glass-strong fixed flex flex-col overflow-hidden text-fg shadow-pop',
          phone ? 'inset-0 rounded-none border-0' : 'rounded-xl',
          layer,
          className,
        )}
      >
        {/* The title bar: arrow keys move the window, as dragging does. */}
        <div
          role="toolbar"
          tabIndex={phone ? undefined : 0}
          aria-label={phone ? undefined : `Move ${label} (arrow keys)`}
          onPointerDown={phone ? undefined : begin('move')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={phone ? undefined : onKey}
          className={cn(
            'flex h-10 shrink-0 items-center gap-2 bg-bg/40 pr-1.5 pl-3 outline-none select-none focus-visible:shadow-[inset_0_0_0_2px_var(--select)]',
            !phone && 'cursor-grab active:cursor-grabbing',
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">{title}</div>
          {actions && <div className="flex shrink-0 items-center">{actions}</div>}
        </div>
        {/* A light wash under the reading area: the title bar stays the frostiest part. */}
        <div className="min-h-0 flex-1 bg-bg/40">{children}</div>
        {!phone &&
          HANDLES.map((h) => (
            <div
              key={h.edge}
              aria-hidden
              onPointerDown={begin(h.edge)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              className={cn('absolute z-10 touch-none', h.className)}
            />
          ))}
      </section>
    </>,
    document.body,
  )
}
