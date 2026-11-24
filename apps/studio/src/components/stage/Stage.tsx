/**
 * <Stage/>: the 3D viewport on the photographic sweep. Mounts a {@link Viewer}, forwards
 * evaluation and view state to it, and turns pointer input into picks: a click (not a drag)
 * picks, hovering highlights (throttled to frames, paused while the camera moves), wheel input
 * is read as mouse zoom or trackpad orbit, Shift-drag pans.
 */
import type { Evaluation } from '@pave/kernel'
import { cn } from '@pave/ui'
import CameraControls from 'camera-controls'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { setLiveViewer } from './capture'
import type { GpuTier } from './quality'
import { Viewer, type ViewerPick, type ViewerState } from './viewer'
import { classifyWheel, type WheelDevice } from './wheel'

export interface StageProps {
  evaluation: Evaluation | null
  state: ViewerState
  onPick?: (pick: ViewerPick | null, opts: { additive: boolean }) => void
  onHover?: (pick: ViewerPick | null) => void
  onContextMenu?: (pick: ViewerPick | null) => void
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

export function Stage({
  evaluation,
  state,
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
    let v: Viewer
    try {
      v = new Viewer(canvas.current!, el)
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
      const r = el.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top] as const
    }
    let down: { x: number; y: number } | null = null
    let hoverFrame = 0
    const onPointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
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
      const intent = classifyWheel(e, callbacks.current.wheel)
      if (intent.type !== 'orbit') return
      // A trackpad swipe orbits; camera-controls would otherwise read it as zoom.
      e.preventDefault()
      e.stopPropagation()
      v.orbit(-intent.dx * 0.25, -intent.dy * 0.25)
    }
    const onContext = (e: MouseEvent) => {
      const [x, y] = local(e)
      callbacks.current.onContextMenu?.(v.pick(x, y))
    }
    // Middle-click paste on Linux would drop clipboard text into whatever has focus.
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    }
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('wheel', onWheel, { capture: true, passive: false })
    el.addEventListener('contextmenu', onContext)
    el.addEventListener('auxclick', onAuxClick)
    return () => {
      cancelAnimationFrame(hoverFrame)
      resize.disconnect()
      theme.disconnect()
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerleave', onPointerLeave)
      el.removeEventListener('wheel', onWheel, { capture: true })
      el.removeEventListener('contextmenu', onContext)
      el.removeEventListener('auxclick', onAuxClick)
      callbacks.current.onBeforeDispose?.(v)
      setLiveViewer(null)
      viewer.current = null
      callbacks.current.onViewer?.(null, null)
      v.dispose()
    }
  }, [])

  useEffect(() => {
    if (evaluation) viewer.current?.setEvaluation(evaluation)
  }, [evaluation])

  useEffect(() => {
    viewer.current?.setState(state)
  }, [state])

  return (
    <div ref={host} className={cn('stage relative isolate h-full w-full overflow-hidden', className)}>
      <canvas
        ref={canvas}
        aria-label={label}
        className={cn('absolute inset-0 size-full touch-none outline-none', failed && 'hidden')}
      />
      {children}
    </div>
  )
}
