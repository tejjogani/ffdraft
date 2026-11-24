/**
 * <Stage/>: the 3D viewport on the photographic sweep. Mounts a {@link Viewer}, forwards
 * evaluation and view state to it, and turns pointer input on the canvas into picks: a click
 * (not a drag) picks, hovering highlights (throttled to frames, paused while the camera moves),
 * wheel input is read as mouse zoom or trackpad orbit, Shift-drag pans. Overlays passed as
 * children (toolbars, chips) sit above the canvas and never pick through it.
 *
 * The canvas is focusable (`role="application"`): the arrow keys orbit while it has focus.
 */
import type { Evaluation } from '@pave/kernel'
import { cn } from '@pave/ui'
import CameraControls from 'camera-controls'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { setLiveViewer } from './capture'
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
  /** The viewer once created, or null when WebGL is unavailable. */
  onViewer?: (viewer: Viewer | null, tier: GpuTier | null) => void
  /** Last chance to use the viewer (e.g. capture a cover) before it is disposed. */
  onBeforeDispose?: (viewer: Viewer) => void
  wheel?: WheelDevice
  label?: string
  className?: string
  children?: ReactNode
}

const CLICK_SLOP_PX = 4

/** Chromium and WebKit still send the legacy per-notch deltas the wheel classifier reads. */
type WheelLegacy = { wheelDeltaX?: number; wheelDeltaY?: number }

export function Stage({
  evaluation,
  state,
  frameNodeIds,
  onPick,
  onHover,
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
  const callbacks = useRef({ onPick, onHover, onViewer, onBeforeDispose, wheel })
  callbacks.current = { onPick, onHover, onViewer, onBeforeDispose, wheel }

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
    let down: { x: number; y: number } | null = null
    let hoverFrame = 0
    const wheels = createWheelClassifier()
    const onPointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
      // Clicking the view gives it the keyboard (arrow keys orbit), as a click on a field would.
      cv.focus({ preventScroll: true })
      v.controls.mouseButtons.left = e.shiftKey
        ? CameraControls.ACTION.TRUCK
        : CameraControls.ACTION.ROTATE
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!down || e.button !== 0) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > CLICK_SLOP_PX) return
      const [x, y] = local(e)
      callbacks.current.onPick?.(v.pick(x, y), { additive: e.shiftKey || e.metaKey || e.ctrlKey })
    }
    const onPointerMove = (e: PointerEvent) => {
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
    // Picking listens on the canvas only: a click on a toolbar above it is not a click on the
    // model behind the button.
    cv.addEventListener('pointerdown', onPointerDown)
    cv.addEventListener('pointerup', onPointerUp)
    cv.addEventListener('pointermove', onPointerMove)
    cv.addEventListener('pointerleave', onPointerLeave)
    // Capture on the host so this runs before camera-controls' own wheel listener on the canvas.
    el.addEventListener('wheel', onWheel, { capture: true, passive: false })
    cv.addEventListener('auxclick', onAuxClick)
    return () => {
      cancelAnimationFrame(hoverFrame)
      resize.disconnect()
      theme.disconnect()
      cv.removeEventListener('pointerdown', onPointerDown)
      cv.removeEventListener('pointerup', onPointerUp)
      cv.removeEventListener('pointermove', onPointerMove)
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
    <div
      ref={host}
      className={cn('stage relative isolate h-full w-full overflow-clip', className)}
    >
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
