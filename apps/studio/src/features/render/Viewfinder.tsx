/**
 * The selected shot as a viewfinder: drawn live from the same resolved scene Blender renders,
 * and framed by hand. Orbit, pan, come closer and roll with mouse, trackpad, touch or keys
 * (see viewfinder-gestures.ts; the wheel reads mouse and trackpad as the CAD view does); each gesture is saved as one change to the shot (a custom camera:
 * position, target, lens and roll), which Undo takes back. While a gesture runs only the camera
 * moves; on release the whole scene is resolved again, so the picture then is exactly the take.
 *
 * Over the picture: the output frame (the canvas is the shot's aspect), a frame-safe margin, an
 * optional rule-of-thirds grid, and where the piece will land with how much of the frame it
 * fills ("62% · good", in the critique's bands). A locked camera ignores every gesture.
 */
import type { Evaluation } from '@pave/kernel'
import {
  customCameraPatch,
  type Framing,
  poseOf,
  type ResolvedCamera,
  type ResolvedScene,
  sceneHash,
  type ViewPose,
} from '@pave/render'
import type { RenderScene } from '@pave/schema'
import { Chip, cn, IconButton } from '@pave/ui'
import { Grid3x3, Lock, LockOpen, Pause, Play, RotateCcw } from 'lucide-react'
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { QualityIndicator, useQuality } from '../../components/stage/QualityIndicator'
import { createWheelClassifier } from '../../components/stage/wheel'
import { ShotRenderer } from './shot-renderer'
import {
  type DragMode,
  drag,
  dragModeOf,
  framingOf,
  framingPoints,
  key,
  pinch,
  type Touch2,
  touchOf,
  wheel,
} from './viewfinder-gestures'

/** A wheel or key burst is one change: saved once nothing has moved for this long. */
const SETTLE_MS = 450

const GRID_KEY = 'pave.viewfinder.grid'
const readGrid = () => {
  try {
    return localStorage.getItem(GRID_KEY) === '1'
  } catch {
    return false
  }
}

/** The pose as a camera both renderers read: near and far planes follow the distance. */
function cameraOf(base: ResolvedCamera, p: ViewPose, radius: number): ResolvedCamera {
  return {
    ...base,
    target: p.target,
    azimuth: p.azimuth,
    elevation: p.elevation,
    distance: p.distance,
    roll: p.roll,
    near: Math.max(0.05, p.distance * 0.02),
    far: p.distance + radius * 200,
  }
}

export interface ViewfinderHandle {
  commitPending(): void
}

export function Viewfinder({
  ref,
  evaluation,
  scene,
  design,
  label,
  className,
  onCommit,
  onLock,
  onReset,
  onHash,
}: {
  ref?: Ref<ViewfinderHandle>
  evaluation: Evaluation | null
  scene: RenderScene
  /** The piece and version the picture is of: part of the scene fingerprint. */
  design: { pieceId: string; version: number } | null
  label: string
  className?: string
  /** A finished gesture, as a scene patch. */
  onCommit: (patch: Record<string, unknown>) => void
  onLock: (locked: boolean) => void
  onReset: () => void
  /** The fingerprint of the scene now drawn (what a take of this view renders). */
  onHash?: (hash: string | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<ShotRenderer | null>(null)
  /** The same renderer as state, for the quality indicator. */
  const [live, setLive] = useState<ShotRenderer | null>(null)
  const quality = useQuality(live)
  const [failed, setFailed] = useState<string | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [resolved, setResolved] = useState<ResolvedScene | null>(null)
  /** The pose while a gesture runs (and until the saved shot comes back), else null. */
  const [pose, setPose] = useState<ViewPose | null>(null)
  const poseRef = useRef<ViewPose | null>(null)
  const [grid, setGrid] = useState(readGrid)
  const [hint, setHint] = useState<string | null>(null)
  const locked = scene.camera.locked === true

  useEffect(() => {
    try {
      renderer.current = new ShotRenderer(canvas.current!, { live: true })
      setLive(renderer.current)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'WebGL is not available')
    }
    return () => {
      renderer.current?.dispose()
      renderer.current = null
      setLive(null)
    }
  }, [])

  useLayoutEffect(() => {
    const el = host.current!
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect
      setBox({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The frame keeps the take's aspect (the resolved output's, as both renderers use it).
  const aspect = resolved
    ? resolved.output.width / resolved.output.height
    : scene.output.width / scene.output.height
  // An animated shot keeps a row under the frame for its scrubber.
  const room = { width: box.width, height: Math.max(0, box.height - (scene.animation ? 40 : 0)) }
  const fit =
    room.width / Math.max(1, room.height) > aspect
      ? { width: room.height * aspect, height: room.height }
      : { width: room.width, height: room.width / aspect }

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new still quality is a trigger to draw again
  useEffect(() => {
    const r = renderer.current
    if (!r || !evaluation || fit.width < 8 || fit.height < 8) return
    // Not in the middle of a drag (the machine just proved slow, say): the drag's release saves
    // the shot, and that draws the new picture anyway.
    if (pointers.current.size > 0) return
    // Next frame, so a burst of changes draws once. The still picture's sharpness follows the
    // Performance setting (a Retina laptop in Auto draws at 1.5, not 2).
    const dpr = r.stillDpr()
    const frame = requestAnimationFrame(() => {
      try {
        setResolved(r.draw(evaluation, scene, fit.width * dpr, fit.height * dpr))
        // The saved shot is back (or changed elsewhere): it is what is drawn now.
        poseRef.current = null
        setPose(null)
        setFailed(null)
      } catch (e) {
        setFailed(e instanceof Error ? e.message : String(e))
      }
    })
    return () => cancelAnimationFrame(frame)
    // A new still quality (the setting changed, or the machine proved slow) draws again.
  }, [evaluation, scene, fit.width, fit.height, quality?.stillDpr, quality?.stillEffects])

  const points = useMemo(() => (evaluation ? framingPoints(evaluation) : []), [evaluation])
  const radius = resolved?.subject.radius ?? 10
  const current = pose ?? (resolved ? poseOf(resolved.camera, radius) : null)
  const framing: Framing | null = current ? framingOf(current, aspect, points) : null
  // By value: the caller builds `design` afresh on every render.
  const pieceId = design?.pieceId
  const version = design?.version
  const hash = useMemo(
    () =>
      resolved && pieceId !== undefined && version !== undefined
        ? sceneHash(resolved, { pieceId, version })
        : null,
    [resolved, pieceId, version],
  )
  useEffect(() => onHash?.(hash), [hash, onHash])

  // ── Motion ──────────────────────────────────────────────────────────────────────────────
  // An animated shot can be scrubbed and played before render time is spent: the same tracks,
  // sampled by the same easing, that Blender keys. A new picture starts again at frame 0.
  const motion = resolved?.animation ?? null
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const frameRef = useRef(0)
  frameRef.current = frame
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new resolved scene is the trigger
  useEffect(() => {
    setFrame(0)
    setPlaying(false)
  }, [resolved])
  useEffect(() => {
    if (motion) renderer.current?.setFrame(frame)
  }, [frame, motion])
  useEffect(() => {
    if (!playing || !motion) return
    let raf = 0
    const from = performance.now()
    const first = frameRef.current
    const tick = (now: number) => {
      setFrame((first + Math.floor(((now - from) / 1000) * motion.fps)) % motion.frameCount)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, motion])

  // ── Gestures ────────────────────────────────────────────────────────────────────────────
  const latest = useRef({ resolved, radius, scene, onCommit, fit, locked, aspect })
  latest.current = { resolved, radius, scene, onCommit, fit, locked, aspect }

  const frameRequest = useRef(0)
  const show = (next: ViewPose) => {
    poseRef.current = next
    setPose(next)
    cancelAnimationFrame(frameRequest.current)
    frameRequest.current = requestAnimationFrame(() => {
      const { resolved: r, radius: rad } = latest.current
      if (r && poseRef.current)
        renderer.current?.setCamera(cameraOf(r.camera, poseRef.current, rad))
    })
  }
  const start = (): ViewPose | null => {
    const { resolved: r, radius: rad, locked: l } = latest.current
    if (l) {
      setHint('The camera is locked. Unlock it to move it.')
      return null
    }
    if (!r) return null
    return poseRef.current ?? poseOf(r.camera, rad)
  }
  const prepareCommit = (): (() => void) | undefined => {
    const { resolved: r, scene: s, onCommit: save } = latest.current
    const p = poseRef.current
    if (!r || !p) return
    const base = s.camera.preset === 'custom' ? s.camera.basePreset : s.camera.preset
    const patch = customCameraPatch(p, r.subject, base)
    // A later render can change the selected shot before this wheel burst settles.
    return () => save(patch)
  }
  const pending = useRef<{ apply: () => void; timer: ReturnType<typeof setTimeout> } | null>(null)
  const takePending = () => {
    const gesture = pending.current
    pending.current = null
    clearTimeout(gesture?.timer)
    return gesture?.apply
  }
  const commitPending = () => takePending()?.()
  useImperativeHandle(ref, () => ({ commitPending }))
  const commit = () => {
    takePending()
    prepareCommit()?.()
  }
  const commitSoon = () => {
    takePending()
    const apply = prepareCommit()
    if (apply) pending.current = { apply, timer: setTimeout(commitPending, SETTLE_MS) }
  }
  useEffect(() => () => clearTimeout(pending.current?.timer), [])
  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 2500)
    return () => clearTimeout(t)
  }, [hint])

  const wheels = useRef(createWheelClassifier())
  const pointers = useRef(new Map<number, [number, number]>())
  const gesture = useRef<{ mode: DragMode; moved: boolean; touch: Touch2 | null }>({
    mode: 'orbit',
    moved: false,
    touch: null,
  })
  const at = (e: { clientX: number; clientY: number }): [number, number] => [e.clientX, e.clientY]
  const touchNow = (): Touch2 | null => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? touchOf(a, b) : null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!start()) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, at(e))
    gesture.current = {
      mode: dragModeOf(e),
      moved: gesture.current.moved && pointers.current.size > 1,
      touch: touchNow(),
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const last = pointers.current.get(e.pointerId)
    if (!last) return
    const p = start()
    if (!p) return
    const { fit: f } = latest.current
    const now = at(e)
    pointers.current.set(e.pointerId, now)
    const g = gesture.current
    if (pointers.current.size >= 2) {
      const touch = touchNow()
      if (g.touch && touch) show(pinch(p, g.touch, touch, f.width, f.height))
      g.touch = touch
    } else {
      const dx = now[0] - last[0]
      const dy = now[1] - last[1]
      if (!dx && !dy) return
      show(drag(p, g.mode, dx, dy, f.width, f.height))
    }
    g.moved = true
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return
    gesture.current.touch = touchNow()
    if (pointers.current.size === 0 && gesture.current.moved) {
      gesture.current.moved = false
      commit()
    }
  }

  // Wheel and pinch need a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = start()
      if (!p) return
      // As in the CAD view: a mouse wheel or a pinch comes closer, a trackpad swipe orbits.
      const intent = wheels.current.classify(e)
      const { fit: f } = latest.current
      show(
        intent.type === 'orbit'
          ? drag(p, 'orbit', -intent.dx, -intent.dy, f.width, f.height)
          : wheel(p, e.ctrlKey ? e.deltaY * 4 : e.deltaY),
      )
      commitSoon()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey) return
    const base = latest.current.resolved ? start() : null
    if (!base) return
    const next = key(base, e, latest.current.aspect)
    if (!next) return
    e.preventDefault()
    show(next)
    commitSoon()
  }

  const custom = scene.camera.preset === 'custom'
  const tone = !framing
    ? 'neutral'
    : framing.verdict === 'good'
      ? 'ok'
      : framing.verdict === 'cropped' || framing.verdict === 'empty'
        ? 'danger'
        : 'warn'

  return (
    <div className={className}>
      <div
        ref={host}
        className="relative flex size-full flex-col items-center justify-center gap-2"
      >
        <div
          className="relative"
          style={{ width: fit.width, height: fit.height }}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the viewfinder takes keys to frame the shot
          tabIndex={0}
          data-scene-hash={hash ?? undefined}
          role="application"
          aria-label={`${label}. Viewfinder: drag to orbit, shift-drag to pan, alt-drag to roll, scroll to come closer; arrow keys orbit, alt+arrows pan, plus and minus zoom, brackets roll.`}
          onKeyDown={onKeyDown}
        >
          <canvas
            ref={canvas}
            role="img"
            aria-label={label}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(e) => e.preventDefault()}
            style={{ width: fit.width, height: fit.height, touchAction: 'none' }}
            className={cn(
              'block rounded-sm shadow-[0_0_0_1px_var(--line)]',
              locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
              (failed || !evaluation) && 'invisible',
            )}
          />
          {!failed && evaluation && (
            <FrameOverlay framing={framing} grid={grid} width={fit.width} height={fit.height} />
          )}
          {!failed && evaluation && (
            <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
              <div className="flex flex-wrap gap-1">
                {framing && (
                  <Chip tone={tone} className="bg-bg/85 tabular" aria-live="polite">
                    {framing.label}
                  </Chip>
                )}
                <Chip outline className="bg-bg/85 font-mono">
                  {scene.output.width}×{scene.output.height}
                </Chip>
                {custom && <Chip className="bg-bg/85">Custom view</Chip>}
                {/* Top left: the bottom-left corner carries the Render tab's caption. */}
                <QualityIndicator source={live} className="pointer-events-auto" />
              </div>
              <div className="pointer-events-auto flex items-center gap-0.5 rounded-md bg-bg/85 p-0.5 shadow-sm">
                <IconButton
                  icon={Grid3x3}
                  size="sm"
                  label="Rule-of-thirds grid"
                  active={grid}
                  onClick={() => {
                    const next = !grid
                    setGrid(next)
                    try {
                      localStorage.setItem(GRID_KEY, next ? '1' : '0')
                    } catch {
                      // A private window: the grid simply is not remembered.
                    }
                  }}
                />
                <IconButton
                  icon={locked ? Lock : LockOpen}
                  size="sm"
                  label={locked ? 'Unlock camera' : 'Lock camera'}
                  active={locked}
                  onClick={() => {
                    commitPending()
                    onLock(!locked)
                  }}
                />
                <IconButton
                  icon={RotateCcw}
                  size="sm"
                  label="Reset to the preset"
                  disabled={!custom || locked}
                  onClick={() => {
                    takePending()
                    onReset()
                  }}
                />
              </div>
            </div>
          )}
          {hint && (
            <p
              role="status"
              className="glass pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 rounded-md px-2 py-1 text-xs whitespace-nowrap"
            >
              {hint}
            </p>
          )}
          {hash && !failed && evaluation && (
            <span
              className="pointer-events-none absolute right-2 bottom-2 rounded-xs bg-bg/85 px-1.5 py-0.5 font-mono text-3xs text-fg-muted"
              title="Fingerprint of the exact scene a take of this view renders. A take with the same fingerprint is this picture."
            >
              scene {hash.slice(0, 8)}
            </span>
          )}
        </div>
        {motion && !failed && evaluation && (
          <MotionScrubber
            width={Math.min(box.width, Math.max(220, fit.width))}
            frame={frame}
            frameCount={motion.frameCount}
            fps={motion.fps}
            playing={playing}
            onFrame={(f) => {
              setPlaying(false)
              setFrame(f)
            }}
            onPlay={setPlaying}
          />
        )}
        {failed && (
          <p className="absolute max-w-sm text-center text-sm text-fg-muted">
            The live preview isn’t available in this browser ({failed}). Takes still render.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Scrubbing an animated shot: play or pause, and a slider over its frames with the time. Not
 * started on its own (reduced motion is respected by never auto-playing).
 */
function MotionScrubber({
  width,
  frame,
  frameCount,
  fps,
  playing,
  onFrame,
  onPlay,
}: {
  /** The frame's width: the scrubber sits under it, as wide. */
  width: number
  frame: number
  frameCount: number
  fps: number
  playing: boolean
  onFrame: (frame: number) => void
  onPlay: (playing: boolean) => void
}) {
  return (
    <div
      className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-bg px-1.5 shadow-[0_0_0_1px_var(--line)]"
      style={{ width }}
    >
      <IconButton
        icon={playing ? Pause : Play}
        size="sm"
        label={playing ? 'Pause the motion' : 'Play the motion'}
        onClick={() => onPlay(!playing)}
      />
      <input
        type="range"
        min={0}
        max={frameCount - 1}
        step={1}
        value={frame}
        aria-label="Motion frame"
        aria-valuetext={`Frame ${frame + 1} of ${frameCount}`}
        onChange={(e) => onFrame(Number(e.target.value))}
        className="min-w-0 flex-1 accent-[var(--select)]"
      />
      <span className="shrink-0 font-mono text-3xs text-fg-muted tabular">
        {(frame / fps).toFixed(1)} / {(frameCount / fps).toFixed(1)} s
      </span>
    </div>
  )
}

/**
 * The output frame's guides: the frame-safe margin (the critique's 5 %), an optional
 * rule-of-thirds grid, and the box the piece will fill.
 */
function FrameOverlay({
  framing,
  grid,
  width,
  height,
}: {
  framing: Framing | null
  grid: boolean
  width: number
  height: number
}) {
  const m = 0.05
  const b = framing?.box
  const box = `0 0 ${width} ${height}`
  return (
    <>
      {/* The guides lie over the picture, light or dark whatever the app's theme: white
          strokes blended by difference read on any backdrop. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 mix-blend-difference"
        width={width}
        height={height}
        viewBox={box}
      >
        <rect
          x={width * m}
          y={height * m}
          width={width * (1 - 2 * m)}
          height={height * (1 - 2 * m)}
          fill="none"
          stroke="#fff"
          strokeOpacity={0.45}
          strokeDasharray="4 4"
        />
        {grid &&
          [1 / 3, 2 / 3].map((k) => (
            <g key={k} stroke="#fff" strokeOpacity={0.4}>
              <line x1={width * k} x2={width * k} y1={0} y2={height} />
              <line y1={height * k} y2={height * k} x1={0} x2={width} />
            </g>
          ))}
      </svg>
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0"
        width={width}
        height={height}
        viewBox={box}
      >
        {b && (
          <rect
            x={b[0] * width}
            y={b[1] * height}
            width={(b[2] - b[0]) * width}
            height={(b[3] - b[1]) * height}
            fill="none"
            stroke="var(--select)"
            strokeOpacity={0.8}
            strokeWidth={1}
          />
        )}
      </svg>
    </>
  )
}
