/**
 * <Stage/>: the 3D viewport on the photographic sweep. Mounts a {@link Viewer}, forwards
 * evaluation and view state to it, and turns pointer input on the canvas into picks: a click
 * (not a drag) picks, hovering highlights (throttled to frames, paused while the camera moves),
 * wheel input is read as mouse zoom or trackpad orbit, Shift-drag pans. A right-click that did
 * not move (right-drag pans) or a long press opens the context menu. Overlays passed as
 * children (toolbars, chips) sit above the canvas and never pick through it.
 *
 * The canvas is focusable (`role="application"`): the arrow keys orbit while it has focus, and
 * Shift+F10 or the Menu key opens the context menu.
 */
import type { Evaluation } from '@pave/kernel'
import { cn, isMac, isMenuKey } from '@pave/ui'
import CameraControls from 'camera-controls'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { setLiveViewer } from './capture'
import { isClick, isSecondary, LONG_PRESS_MS, LONG_PRESS_SLOP_PX, type Point } from './gesture'
import type { GpuTier } from './quality'
import { Viewer, type ViewerPick, type ViewerState } from './viewer'
import { createWheelClassifier, type WheelDevice } from './wheel'

export interface StageProps {
  evaluation: Evaluation | null
  state: ViewerState
  /** Nodes the default views frame (e.g. a pendant without its chain); omitted = everything. */
  frameNodeIds?: readonly string[]
  onPick?: (pick: ViewerPick | null, opts: { additive: boolean }) => void
  onHover?: (pick: ViewerPick | null) => void
  /**
   * The context menu, at client coordinates: a right-click (Control-click on macOS) or a long
   * press that did not move, with what is under it; or Shift+F10 / the Menu key while the view
   * has the keyboard, with no pick, at the view's centre (the caller uses the selection).
   */
  onContextMenu?: (pick: ViewerPick | null, at: Point, source: 'pointer' | 'keyboard') => void
  /** The viewer once created, or null when WebGL is unavailable. */
  onViewer?: (viewer: Viewer | null, tier: GpuTier | null) => void
  /** Last chance to use the viewer (e.g. capture a cover) before it is disposed. */
  onBeforeDispose?: (viewer: Viewer) => void
  wheel?: WheelDevice
  label?: string
  className?: string
  children?: ReactNode
}

/** Chromium and WebKit still send the legacy per-notch deltas the wheel classifier reads. */
type WheelLegacy = { wheelDeltaX?: number; wheelDeltaY?: number }

export function Stage({
  evaluation,
  state,
  frameNodeIds,
  onPick,
  onHover,
  onContextMenu,
  onViewer,
  onBeforeDispose,
  wheel = 'auto',
  label = '3D view',
  className,
  children,
}: StageProps) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const [failed, setFailed] = useState(false)
  const callbacks = useRef({ onPick, onHover, onContextMenu, onViewer, onBeforeDispose, wheel })
  callbacks.current = { onPick, onHover, onContextMenu, onViewer, onBeforeDispose, wheel }

  useEffect(() => {
    const el = host.current!
    const cv = canvas.current!
    let v: Viewer
    try {
      v = new Viewer(cv, el)
    } catch {
      setFailed(true)
      callbacks.current.onViewer?.(null, null)
      return
    }
    viewer.current = v
    setLiveViewer(v)
    // Development and e2e hook: benchmarks and camera checks drive the viewer directly.
    if (import.meta.env.DEV) (window as { paveViewer?: Viewer }).paveViewer = v
    callbacks.current.onViewer?.(v, v.tier)

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect
      v.setSize(width, height)
    })
    resize.observe(el)
    const theme = new MutationObserver(() => v.refreshTheme())
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const local = (e: { clientX: number; clientY: number }) => {
      const r = cv.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top] as const
    }
    /** The press of a pick (left button, or a finger). */
    let down: Point | null = null
    /** The press of a context menu (right button). */
    let secondary: Point | null = null
    let longPress: ReturnType<typeof setTimeout> | undefined
    /** A long press opened the menu; the release that ends it is not a pick. */
    let longPressed = false
    let hoverFrame = 0
    const wheels = createWheelClassifier()
    const at = (e: { clientX: number; clientY: number }): Point => ({ x: e.clientX, y: e.clientY })
    const openMenu = (p: Point) => {
      const [x, y] = local({ clientX: p.x, clientY: p.y })
      callbacks.current.onContextMenu?.(v.pick(x, y), p, 'pointer')
    }
    const cancelLongPress = () => {
      clearTimeout(longPress)
      longPress = undefined
    }
    const onPointerDown = (e: PointerEvent) => {
      // Clicking the view gives it the keyboard (arrow keys orbit), as a click on a field would.
      cv.focus({ preventScroll: true })
      v.controls.mouseButtons.left = e.shiftKey
        ? CameraControls.ACTION.TRUCK
        : CameraControls.ACTION.ROTATE
      cancelLongPress()
      if (isSecondary(e, isMac)) {
        secondary = at(e)
        down = null
        return
      }
      down = at(e)
      longPressed = false
      // A second finger is a pinch or a pan, never a long press.
      if (e.pointerType === 'touch' && e.isPrimary) {
        const start = at(e)
        longPress = setTimeout(() => {
          longPress = undefined
          longPressed = true
          openMenu(start)
        }, LONG_PRESS_MS)
      }
    }
    const onPointerUp = (e: PointerEvent) => {
      cancelLongPress()
      if (secondary && isSecondary(e, isMac)) {
        const start = secondary
        secondary = null
        if (isClick(start, at(e))) openMenu(at(e))
        return
      }
      if (!down || e.button !== 0) return
      const start = down
      down = null
      if (longPressed) {
        longPressed = false
        return
      }
      if (!isClick(start, at(e))) return
      const [x, y] = local(e)
      callbacks.current.onPick?.(v.pick(x, y), { additive: e.shiftKey || e.metaKey || e.ctrlKey })
    }
    const onPointerCancel = () => {
      cancelLongPress()
      down = null
      secondary = null
    }
    const onPointerMove = (e: PointerEvent) => {
      if (longPress && down && !isClick(down, at(e), LONG_PRESS_SLOP_PX)) cancelLongPress()
      if (e.buttons || e.pointerType !== 'mouse' || hoverFrame) return
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0
        if (v.isMoving) return
        const [x, y] = local(e)
        callbacks.current.onHover?.(v.pick(x, y))
      })
    }
    const onPointerLeave = () => callbacks.current.onHover?.(null)
    const onWheel = (e: WheelEvent) => {
      if (e.target !== cv) return
      const intent = wheels.classify(e as WheelEvent & WheelLegacy, callbacks.current.wheel)
      if (intent.type !== 'orbit') return
      // A trackpad swipe orbits; camera-controls would otherwise read it as zoom.
      e.preventDefault()
      e.stopPropagation()
      v.orbit(-intent.dx * 0.25, -intent.dy * 0.25)
    }
    // Middle-click paste on Linux would drop clipboard text into whatever has focus.
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    }
    // The browser's own menu never shows over the model: ours opens on release, without movement.
    const onNativeMenu = (e: MouseEvent) => e.preventDefault()
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isMenuKey(e)) return
      e.preventDefault()
      const r = cv.getBoundingClientRect()
      callbacks.current.onContextMenu?.(
        null,
        { x: r.left + r.width / 2, y: r.top + r.height / 2 },
        'keyboard',
      )
    }
    // Picking listens on the canvas only: a click on a toolbar above it is not a click on the
    // model behind the button.
    cv.addEventListener('pointerdown', onPointerDown)
    cv.addEventListener('pointerup', onPointerUp)
    cv.addEventListener('pointercancel', onPointerCancel)
    cv.addEventListener('pointermove', onPointerMove)
    cv.addEventListener('contextmenu', onNativeMenu)
    cv.addEventListener('keydown', onKeyDown)
    cv.addEventListener('pointerleave', onPointerLeave)
    // Capture on the host so this runs before camera-controls' own wheel listener on the canvas.
    el.addEventListener('wheel', onWheel, { capture: true, passive: false })
    cv.addEventListener('auxclick', onAuxClick)
    return () => {
      cancelAnimationFrame(hoverFrame)
      cancelLongPress()
      resize.disconnect()
      theme.disconnect()
      cv.removeEventListener('pointerdown', onPointerDown)
      cv.removeEventListener('pointerup', onPointerUp)
      cv.removeEventListener('pointercancel', onPointerCancel)
      cv.removeEventListener('pointermove', onPointerMove)
      cv.removeEventListener('contextmenu', onNativeMenu)
      cv.removeEventListener('keydown', onKeyDown)
      cv.removeEventListener('pointerleave', onPointerLeave)
      el.removeEventListener('wheel', onWheel, { capture: true })
      cv.removeEventListener('auxclick', onAuxClick)
      callbacks.current.onBeforeDispose?.(v)
      setLiveViewer(null)
      viewer.current = null
      callbacks.current.onViewer?.(null, null)
      v.dispose()
    }
  }, [])

  const focus = frameNodeIds?.join(',') ?? ''
  // Before the evaluation effect, so the first framing already knows what to frame.
  useEffect(() => {
    viewer.current?.setFrameFocus(focus ? focus.split(',') : [])
  }, [focus])

  useEffect(() => {
    if (evaluation) viewer.current?.setEvaluation(evaluation)
  }, [evaluation])

  useEffect(() => {
    viewer.current?.setState(state)
  }, [state])

  return (
    <div ref={host} className={cn('stage relative isolate h-full w-full overflow-clip', className)}>
      {/* biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: the 3D view is an application region with its own keys (arrows orbit) */}
      <canvas
        ref={canvas}
        role="application"
        tabIndex={0}
        aria-label={label}
        className={cn(
          'absolute inset-0 size-full touch-none outline-none',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-select',
          failed && 'hidden',
        )}
      />
      {children}
    </div>
  )
}
