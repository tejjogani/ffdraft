/**
 * Image planes in the CAD view, like Rhino's Picture command: drop a pinned picture on the
 * front, top or right view, fade it, lock it, drag it into place, and scale it by clicking two
 * points on it and typing the real distance (or picking a known stone size). Each change is one
 * saved, undoable step (`references.place`); the pictures are drawn by the viewer behind the
 * piece and never captured, rendered or exported.
 *
 * Mounted inside <Stage/>: pointer input on a selected, unlocked picture moves it instead of
 * orbiting (listeners in the capture phase on the stage, ahead of the camera's own).
 */
import type { ImagePlane, ImagePlaneView, Reference } from '@pave/schema'
import { Button, cn, IconButton, NumberField, Slider, Tooltip } from '@pave/ui'
import { Blend, EyeOff, Lock, LockOpen, Redo2, Ruler, ScanSearch, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Viewer } from '../../components/stage/viewer'
import { assetUrl } from '../../lib/assets'
import { useRegisterCommands } from '../../lib/commands'
import {
  type Bounds,
  fromView,
  initialPlane,
  KNOWN_SIZES,
  moveBy,
  planeDepth,
  scaleByTwoPoints,
  type Vec2,
  VIEW_LABEL,
} from '../../lib/image-planes'
import { useRpc } from '../../lib/query'
import { changePlane, redoPlane, removeFromView, undoPlane } from './actions'
import { PIN_DRAG_TYPE, planeHasFocus, useReferencePanel } from './store'

const VIEWS: ImagePlaneView[] = ['front', 'top', 'right']
const CLICK_SLOP_PX = 4
/** Pictures are drawn from a bounded rendition: plenty to trace over, kind to the GPU. */
const PLANE_PICTURE_PX = 2048

/** Read without subscribing: event handlers and effects want the latest state, not a render. */
const store = useReferencePanel.getState

const aspectOf = (r: Reference) => (r.width && r.height ? r.height / r.width : 1)

export function ImagePlanes({
  viewer,
  pieceId,
  bounds,
  readOnly,
  stoneMm,
}: {
  viewer: Viewer | null
  pieceId: string
  bounds: Bounds | null
  readOnly: boolean
  /** The centre stone's width, offered as a known size to scale against. */
  stoneMm: number | null
}) {
  const pins = useRpc('references.pins', { pieceId })
  const selected = useReferencePanel((s) => (s.selected?.pieceId === pieceId ? s.selected : null))
  const preview = useReferencePanel((s) => s.preview)
  const scaling = useReferencePanel((s) => s.scaling)
  const dragging = useReferencePanel((s) => s.dragging)
  const placeRequest = useReferencePanel((s) => s.placeRequest)
  const history = useReferencePanel((s) => s.histories[pieceId])
  const root = useRef<HTMLDivElement>(null)

  const placed = useMemo(
    () => (pins.data?.references ?? []).filter((r) => r.plane && r.assetId),
    [pins.data],
  )
  const current = placed.find((r) => r.id === selected?.refId) ?? null
  const planeOf = useCallback(
    (r: Reference): ImagePlane => (preview?.refId === r.id ? preview.plane : r.plane!),
    [preview],
  )

  // This CAD view takes "lay it in a view" requests from the panel while it is on screen.
  useEffect(() => {
    store().setViewport(pieceId)
    return () => {
      store().setViewport(null)
      store().select(null)
    }
  }, [pieceId])

  // The viewer draws what is placed; the selected picture gets a frame.
  useEffect(() => {
    viewer?.setImagePlanes(
      placed.map((r) => {
        const plane = planeOf(r)
        return {
          id: r.id,
          url: assetUrl(r.assetId!, PLANE_PICTURE_PX),
          view: plane.view,
          center: plane.center,
          width: plane.width,
          aspect: aspectOf(r),
          opacity: plane.opacity,
          selected: r.id === selected?.refId,
        }
      }),
    )
  }, [viewer, placed, planeOf, selected])
  useEffect(() => () => viewer?.setImagePlanes([]), [viewer])

  // A picture that is no longer placed (unpinned, taken out elsewhere) cannot stay selected.
  useEffect(() => {
    if (selected && pins.data && !current) store().select(null)
  }, [selected, current, pins.data])

  // Carry out "lay it in the … view" from the panel's menu or a drop on the view.
  useEffect(() => {
    if (!placeRequest || placeRequest.pieceId !== pieceId || !pins.data) return
    store().setPlaceRequest(null)
    const ref = pins.data.references.find((r) => r.id === placeRequest.refId)
    if (!ref?.assetId || readOnly) return
    const { view } = placeRequest
    const plane = ref.plane?.view === view ? ref.plane : initialPlane(view, bounds, aspectOf(ref))
    void changePlane(pieceId, ref.id, plane).then((ok) => {
      if (!ok) return
      store().select({ pieceId, refId: ref.id })
      viewer?.alignView(view)
    })
  }, [placeRequest, pieceId, pins.data, bounds, viewer, readOnly])

  // ── Moving by dragging, and selecting by clicking ────────────────────────────────────────
  useEffect(() => {
    const host = root.current?.parentElement
    if (!viewer || !host) return
    const canvas = viewer.canvas
    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top] as const
    }
    let down: { x: number; y: number } | null = null
    let drag: { refId: string; start: Vec2; from: ImagePlane; moved: boolean } | null = null

    const onDown = (e: PointerEvent) => {
      if (e.target !== canvas || e.button !== 0) return
      down = { x: e.clientX, y: e.clientY }
      const s = store()
      if (readOnly || s.scaling || !s.selected || s.selected.pieceId !== pieceId) return
      const ref = placed.find((r) => r.id === s.selected!.refId)
      if (!ref?.plane || ref.plane.locked) return
      const [x, y] = local(e)
      if (viewer.pickPlane(x, y) !== ref.id || viewer.pick(x, y)) return
      const start = viewer.pointOnPlane(ref.plane.view, x, y)
      if (!start) return
      // The picture moves instead of the camera.
      e.stopPropagation()
      e.preventDefault()
      drag = { refId: ref.id, start, from: ref.plane, moved: false }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
      window.addEventListener('pointercancel', onCancel, { once: true })
    }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      const [x, y] = local(e)
      const p = viewer.pointOnPlane(drag.from.view, x, y)
      if (!p) return
      drag.moved = true
      store().setPreview({
        refId: drag.refId,
        plane: moveBy(drag.from, p[0] - drag.start[0], p[1] - drag.start[1]),
      })
    }
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointercancel', onCancel)
      const d = drag
      drag = null
      const next = store().preview
      if (!d) return
      if (commit && d.moved && next?.refId === d.refId)
        void changePlane(pieceId, d.refId, next.plane, { label: 'Moved the picture' }).finally(() =>
          store().setPreview(null),
        )
      else store().setPreview(null)
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    const onClick = (e: PointerEvent) => {
      if (e.target !== canvas || e.button !== 0 || !down || store().scaling) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > CLICK_SLOP_PX) return
      const [x, y] = local(e)
      // A click on the piece is about the piece; on a picture behind it, about the picture.
      const hit = viewer.pick(x, y) ? null : viewer.pickPlane(x, y)
      store().select(hit ? { pieceId, refId: hit } : null)
    }
    host.addEventListener('pointerdown', onDown, { capture: true })
    host.addEventListener('pointerup', onClick, { capture: true })
    return () => {
      host.removeEventListener('pointerdown', onDown, { capture: true })
      host.removeEventListener('pointerup', onClick, { capture: true })
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [viewer, placed, pieceId, readOnly])

  useRegisterCommands([
    {
      id: 'planes.undo',
      title: 'Undo the picture change',
      group: 'Design',
      icon: Undo2,
      shortcut: 'mod+z',
      inEditable: false,
      when: () => planeHasFocus(pieceId, 'undo'),
      run: () => void undoPlane(pieceId),
    },
    {
      id: 'planes.redo',
      title: 'Redo the picture change',
      group: 'Design',
      icon: Redo2,
      shortcut: 'mod+shift+z',
      inEditable: false,
      when: () => planeHasFocus(pieceId, 'redo'),
      run: () => void redoPlane(pieceId),
    },
  ])

  return (
    <div ref={root} className="contents">
      {dragging && !readOnly && <DropZones pieceId={pieceId} />}
      {current && scaling && viewer && (
        <ScaleTool
          viewer={viewer}
          refId={current.id}
          plane={planeOf(current)}
          pieceId={pieceId}
          depth={planeDepth(planeOf(current).view, bounds)}
          stoneMm={stoneMm}
        />
      )}
      {current && viewer && (
        <PlaneScreenRect
          viewer={viewer}
          plane={planeOf(current)}
          aspect={aspectOf(current)}
          depth={planeDepth(planeOf(current).view, bounds)}
        />
      )}
      {current && !scaling && (
        <PlaneToolbar
          pieceId={pieceId}
          ref_={current}
          plane={planeOf(current)}
          readOnly={readOnly}
          canUndo={(history?.undo.length ?? 0) > 0}
          canRedo={(history?.redo.length ?? 0) > 0}
          onAlign={() => viewer?.alignView(planeOf(current).view)}
        />
      )}
    </div>
  )
}

/**
 * Where the selected picture is on screen, as a data attribute: what end-to-end checks click
 * against (two points on the picture), and nothing a person sees.
 */
function PlaneScreenRect({
  viewer,
  plane,
  aspect,
  depth,
}: {
  viewer: Viewer
  plane: ImagePlane
  aspect: number
  depth: number
}) {
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  useEffect(() => viewer.onRender(redraw), [viewer])
  const h = plane.width * aspect
  const corners = (
    [
      [-0.5, -0.5],
      [0.5, 0.5],
    ] as const
  ).map(([du, dv]) =>
    viewer.project(
      fromView(plane.view, [plane.center[0] + du * plane.width, plane.center[1] + dv * h], depth),
    ),
  )
  const a = corners[0]!
  const b = corners[1]!
  const rect = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)]
  return <div hidden data-plane-screen={rect.map((n) => n.toFixed(1)).join(',')} />
}

/** While a pin is dragged from the panel: the three views to drop it on. */
function DropZones({ pieceId }: { pieceId: string }) {
  const [over, setOver] = useState<ImagePlaneView | null>(null)
  return (
    <section
      className="absolute inset-0 z-40 flex items-center justify-center gap-3 bg-bg/30 p-6 backdrop-blur-[1px]"
      aria-label="Drop the picture on a view"
    >
      {VIEWS.map((view) => (
        // Drop targets only: the keyboard and touch way is the pin's "Lay in a view" menu.
        // biome-ignore lint/a11y/noStaticElementInteractions: a drag-and-drop target
        <div
          key={view}
          data-drop-view={view}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(PIN_DRAG_TYPE)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setOver(view)
          }}
          onDragLeave={() => setOver((v) => (v === view ? null : v))}
          onDrop={(e) => {
            const refId = e.dataTransfer.getData(PIN_DRAG_TYPE)
            e.preventDefault()
            setOver(null)
            useReferencePanel.getState().setDragging(null)
            if (refId) useReferencePanel.getState().setPlaceRequest({ pieceId, refId, view })
          }}
          className={cn(
            'glass flex aspect-square w-[min(28%,180px)] flex-col items-center justify-center gap-2 rounded-xl text-sm font-medium shadow-sm transition-[outline] duration-120',
            over === view && 'outline-2 outline-select',
          )}
        >
          <ViewGlyph view={view} />
          {VIEW_LABEL[view]} view
        </div>
      ))}
    </section>
  )
}

/** A small drawing of which way the view looks: a ring from the front, the top or the side. */
function ViewGlyph({ view }: { view: ImagePlaneView }) {
  return (
    <svg viewBox="0 0 40 40" className="size-10 text-fg-muted" aria-hidden>
      {view === 'front' && (
        <circle cx="20" cy="22" r="11" fill="none" stroke="currentColor" strokeWidth="3" />
      )}
      {view === 'top' && (
        <rect
          x="8"
          y="17"
          width="24"
          height="6"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
      )}
      {view === 'right' && (
        <ellipse
          cx="20"
          cy="22"
          rx="4"
          ry="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
      )}
      <path d="M17 9 L20 5 L23 9" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function PlaneToolbar({
  pieceId,
  ref_: r,
  plane,
  readOnly,
  canUndo,
  canRedo,
  onAlign,
}: {
  pieceId: string
  ref_: Reference
  plane: ImagePlane
  readOnly: boolean
  canUndo: boolean
  canRedo: boolean
  onAlign: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-16 z-30 flex justify-center">
      <div
        role="toolbar"
        aria-label={`Picture in the ${plane.view} view`}
        className="glass pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-lg px-1.5 py-1 text-sm shadow-sm"
      >
        <Tooltip content={r.title || 'Picture'}>
          <img
            src={assetUrl(r.assetId!, 120)}
            alt={r.title || 'Picture'}
            className="size-7 shrink-0 rounded-sm object-cover"
          />
        </Tooltip>
        <span className="text-xs whitespace-nowrap text-fg-muted">
          {VIEW_LABEL[plane.view]} view
        </span>
        {!readOnly && (
          <>
            <span className="flex shrink-0 items-center gap-1 text-fg-muted">
              <Blend className="size-3.5" aria-hidden />
              <div className="w-16 shrink-0">
                <Slider
                  aria-label="Opacity"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={plane.opacity}
                  onChange={(opacity) =>
                    store().setPreview({ refId: r.id, plane: { ...plane, opacity } })
                  }
                  onCommit={(opacity) =>
                    void changePlane(pieceId, r.id, { ...plane, opacity }).finally(() =>
                      store().setPreview(null),
                    )
                  }
                />
              </div>
            </span>
            <IconButton
              icon={plane.locked ? Lock : LockOpen}
              label={plane.locked ? 'Unlock the picture' : 'Lock the picture'}
              aria-pressed={plane.locked}
              onClick={() => void changePlane(pieceId, r.id, { ...plane, locked: !plane.locked })}
            />
            <Tooltip
              content={
                plane.locked
                  ? 'Unlock it to scale'
                  : 'Click two points, then type the real distance'
              }
            >
              <Button
                size="sm"
                variant="secondary"
                icon={Ruler}
                disabled={plane.locked}
                onClick={() => {
                  onAlign()
                  store().setScaling(true)
                }}
              >
                Scale
              </Button>
            </Tooltip>
          </>
        )}
        <IconButton
          icon={ScanSearch}
          label={`Look straight at the ${plane.view} view`}
          onClick={onAlign}
        />
        {!readOnly && (
          <>
            <IconButton
              icon={Undo2}
              label="Undo the picture change"
              disabled={!canUndo}
              onClick={() => void undoPlane(pieceId)}
            />
            <IconButton
              icon={Redo2}
              label="Redo the picture change"
              disabled={!canRedo}
              onClick={() => void redoPlane(pieceId)}
            />
            <IconButton
              icon={EyeOff}
              label="Take the picture out of the view"
              onClick={() => void removeFromView(pieceId, r)}
            />
          </>
        )}
        <IconButton icon={X} label="Done with the picture" onClick={() => store().select(null)} />
      </div>
    </div>
  )
}

/**
 * Two clicks on the picture, then the real distance between them: the picture is scaled about
 * the first point. The markers follow the camera, which the tool first points straight at the
 * view so the clicks land where they look.
 */
function ScaleTool({
  viewer,
  refId,
  plane,
  pieceId,
  depth,
  stoneMm,
}: {
  viewer: Viewer
  refId: string
  plane: ImagePlane
  pieceId: string
  depth: number
  stoneMm: number | null
}) {
  const [points, setPoints] = useState<Vec2[]>([])
  const [mm, setMm] = useState<number | null>(stoneMm ?? null)
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  useEffect(() => viewer.onRender(redraw), [viewer])
  const screen = (p: Vec2) => viewer.project(fromView(plane.view, p, depth))
  const done = points.length === 2
  const measured = done
    ? Math.hypot(points[1]![0] - points[0]![0], points[1]![1] - points[0]![1])
    : 0

  const apply = () => {
    if (!done || !mm) return
    const next = scaleByTwoPoints(plane, points[0]!, points[1]!, mm)
    if (!next) return
    void changePlane(pieceId, refId, next, { label: 'Scaled the picture' })
    store().setScaling(false)
  }

  const sizes = [
    ...(stoneMm
      ? [{ label: `This piece’s centre stone · ${stoneMm.toFixed(2)} mm`, mm: stoneMm }]
      : []),
    ...KNOWN_SIZES.filter((k) => [5.2, 6.5, 8.2].includes(k.mm)),
  ]

  return (
    <div className="absolute inset-0 z-30" data-scale-tool>
      <div
        className="absolute inset-0 cursor-crosshair"
        onPointerDown={(e) => {
          if (done || e.button !== 0) return
          const rect = viewer.canvas.getBoundingClientRect()
          const p = viewer.pointOnPlane(plane.view, e.clientX - rect.left, e.clientY - rect.top)
          if (p) setPoints((pts) => [...pts, p])
        }}
      />
      <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
        {done && (
          <line
            x1={screen(points[0]!).x}
            y1={screen(points[0]!).y}
            x2={screen(points[1]!).x}
            y2={screen(points[1]!).y}
            stroke="var(--select)"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
        )}
        {points.map((p, i) => {
          const s = screen(p)
          return (
            <g key={i}>
              <circle cx={s.x} cy={s.y} r="7" fill="none" stroke="var(--select)" strokeWidth="2" />
              <circle cx={s.x} cy={s.y} r="2" fill="var(--select)" />
            </g>
          )
        })}
      </svg>
      <div className="pointer-events-none absolute inset-x-3 bottom-16 flex justify-center">
        <div
          role="dialog"
          aria-label="Scale the picture"
          className="glass pointer-events-auto flex w-[min(100%,440px)] flex-col gap-2 rounded-lg p-3 text-sm shadow-sm"
        >
          {!done ? (
            <p>
              {points.length === 0
                ? 'Click the first point of something whose size you know.'
                : 'Now click the second point.'}
            </p>
          ) : (
            <>
              <p>
                Those points are {measured.toFixed(2)} mm apart at the picture’s current size. How
                far apart are they really?
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <NumberField
                  aria-label="Real distance"
                  value={mm}
                  onChange={setMm}
                  onCommit={setMm}
                  unit="mm"
                  min={0.1}
                  max={500}
                  step={0.1}
                  precision={2}
                  className="w-28"
                />
                {sizes.map((k) => (
                  <button
                    key={k.label}
                    type="button"
                    onClick={() => setMm(k.mm)}
                    className={cn(
                      'h-6 rounded-xs px-1.5 text-xs shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-bg-muted',
                      mm === k.mm && 'bg-select-soft text-select shadow-none',
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            {points.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setPoints([])}>
                Start over
              </Button>
            )}
            <Button size="sm" onClick={() => store().setScaling(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={!done || !mm} onClick={apply}>
              Scale the picture
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
