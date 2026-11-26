import type { EvaluatedCurve } from '@pave/kernel'
import {
  CURVE_POINT_LIMIT,
  type CurveCoordinates,
  CurveDefinition,
  type CurvePlane,
  type CurvePoint,
  type NodeOf,
  newId,
  pointFromCurvePlane,
} from '@pave/schema'
import { Button, Input, Segmented } from '@pave/ui'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { Viewer } from '../../../components/stage/viewer'
import { curvePath, useProjection } from './CurveOverlay'
import { CURVE_SNAP_PX, type CurveSnap, snapCurve } from './snapping'

const round = (value: number) => Number(value.toFixed(3))
const axes = { front: ['X', 'Z'], top: ['X', 'Y'], right: ['Y', 'Z'] } as const

export function CurveEditor({
  viewer,
  original,
  snapSources,
  onSave,
  onCancel,
}: {
  viewer: Viewer | null
  original?: NodeOf<'curve'>
  snapSources: readonly EvaluatedCurve[]
  onSave(definition: Pick<NodeOf<'curve'>, 'plane' | 'points' | 'closed'>): void
  onCancel(): void
}) {
  const fieldId = useId()
  const root = useRef<HTMLElement>(null)
  const aperture = useRef<HTMLDivElement>(null)
  const [plane, setPlane] = useState<CurvePlane>(original?.plane ?? 'front')
  const [points, setPoints] = useState<CurvePoint[]>(original?.points ?? [])
  const [closed, setClosed] = useState(original?.closed ?? false)
  const [selected, setSelected] = useState<string | null>(null)
  const [snap, setSnap] = useState<CurveSnap | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [u, setU] = useState('')
  const [v, setV] = useState('')
  const [error, setError] = useState('')
  const world = points.map((p) => pointFromCurvePlane(plane, [p.u, p.v]))
  useProjection(viewer)

  // Changing vertices must not move the camera underneath the pointer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: frame only on entry and a changed plane
  useLayoutEffect(() => {
    setSnap(null)
    if (viewer) viewer.viewConstructionPlane(plane, world)
  }, [viewer, plane])
  useLayoutEffect(() => root.current?.focus({ preventScroll: true }), [])

  const choose = (p: CurvePoint) => {
    setSelected(p.id)
    setU(String(p.u))
    setV(String(p.v))
  }
  const acceptPoint = ([horizontal, vertical]: CurveCoordinates) => {
    if (![horizontal, vertical].every((n) => Number.isFinite(n) && Math.abs(n) <= 250)) {
      setError('Enter coordinates between −250 and 250 mm.')
      return
    }
    if (!selected && points.length >= CURVE_POINT_LIMIT) return
    const next: CurvePoint = { id: selected ?? newId('point'), u: horizontal, v: vertical }
    setPoints(selected ? points.map((p) => (p.id === selected ? next : p)) : [...points, next])
    setSelected(null)
    setU('')
    setV('')
    setError('')
  }
  const locate = (x: number, y: number) => {
    const rect = aperture.current?.getBoundingClientRect()
    return rect ? { x: x - rect.left, y: y - rect.top } : { x: 0, y: 0 }
  }
  const snapAt = (x: number, y: number) =>
    viewer && snapEnabled ? snapCurve(snapSources, plane, { x, y }, (p) => viewer.project(p)) : null

  const submit = () => {
    const definition = CurveDefinition.safeParse({ plane, points, closed })
    if (!definition.success) {
      setError(definition.error.issues[0]?.message ?? 'Check the curve points.')
      return
    }
    try {
      onSave(definition.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the curve.')
    }
  }

  return (
    <section
      ref={root}
      aria-label={original ? 'Edit curve points' : 'Draw curve'}
      tabIndex={-1}
      className="pointer-events-none absolute inset-0 z-30 outline-none"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      {viewer && (
        <div
          ref={aperture}
          role="presentation"
          data-curve-drawing-area
          className="pointer-events-auto absolute inset-0 touch-none cursor-crosshair"
          onPointerMove={(event) => {
            const { x, y } = locate(event.clientX, event.clientY)
            setSnap(snapAt(x, y))
          }}
          onPointerLeave={() => setSnap(null)}
          onPointerUp={(event) => {
            if (event.button !== 0) return
            const { x, y } = locate(event.clientX, event.clientY)
            root.current?.focus({ preventScroll: true })
            if (original && !selected) {
              const near = world.findIndex((worldPoint) => {
                const p = viewer.project(worldPoint)
                return p.visible && Math.hypot(p.x - x, p.y - y) < CURVE_SNAP_PX
              })
              if (near >= 0) {
                choose(points[near]!)
                return
              }
            }
            const snapped = snapAt(x, y)
            const hit = snapped?.point ?? viewer.pointOnConstructionPlane(plane, x, y)?.map(round)
            if (hit) acceptPoint(hit as CurveCoordinates)
          }}
        >
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full">
            <path
              d={curvePath(
                viewer,
                [
                  [-250, 0],
                  [250, 0],
                ].map((p) => pointFromCurvePlane(plane, p as CurveCoordinates)),
              )}
              fill="none"
              className="stroke-line-strong"
            />
            <path
              d={curvePath(
                viewer,
                [
                  [0, -250],
                  [0, 250],
                ].map((p) => pointFromCurvePlane(plane, p as CurveCoordinates)),
              )}
              fill="none"
              className="stroke-line-strong"
            />
            <path
              d={curvePath(viewer, world, closed)}
              fill="none"
              strokeWidth={2}
              className="stroke-select"
            />
            {world.map((point, index) => {
              const p = viewer.project(point)
              const id = points[index]!.id
              return (
                p.visible && (
                  <circle
                    key={id}
                    cx={p.x}
                    cy={p.y}
                    r={selected === id ? 6 : 4}
                    className="fill-select"
                  />
                )
              )
            })}
            {snap && (
              <circle
                cx={snap.screen.x}
                cy={snap.screen.y}
                r={7}
                fill="none"
                strokeWidth={2}
                className="stroke-select"
              />
            )}
          </svg>
          {snap && (
            <span
              className="pointer-events-none absolute rounded-sm bg-bg px-1.5 py-1 text-xs font-medium"
              style={{ left: snap.screen.x + 9, top: snap.screen.y + 9 }}
            >
              {snap.label}
            </span>
          )}
        </div>
      )}
      <div className="glass-strong pointer-events-auto absolute inset-x-3 bottom-3 mx-auto flex max-w-[34rem] flex-col gap-2 rounded-lg border border-line px-3 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{original ? 'Edit curve points' : 'Draw curve'}</h2>
          <Segmented
            aria-label="Curve drawing plane"
            value={plane}
            onChange={setPlane}
            options={[
              { value: 'front', label: 'Front' },
              { value: 'top', label: 'Top' },
              { value: 'right', label: 'Right' },
            ]}
          />
        </div>
        <p className="text-xs text-fg-muted">
          {selected
            ? 'Click a new position or type coordinates to move the point.'
            : 'Click the viewport or type coordinates to add a point.'}
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (u.trim() && v.trim()) acceptPoint([Number(u), Number(v)])
          }}
        >
          <label htmlFor={`${fieldId}-u`} className="flex min-w-16 flex-1 flex-col gap-1 text-xs">
            {axes[plane][0]} (mm)
            <Input
              id={`${fieldId}-u`}
              type="number"
              step="any"
              value={u}
              onChange={(e) => setU(e.target.value)}
            />
          </label>
          <label htmlFor={`${fieldId}-v`} className="flex min-w-16 flex-1 flex-col gap-1 text-xs">
            {axes[plane][1]} (mm)
            <Input
              id={`${fieldId}-v`}
              type="number"
              step="any"
              value={v}
              onChange={(e) => setV(e.target.value)}
            />
          </label>
          <Button
            type="submit"
            disabled={!u.trim() || !v.trim() || (!selected && points.length >= CURVE_POINT_LIMIT)}
          >
            {selected ? 'Move point' : 'Add point'}
          </Button>
        </form>
        {points.length > 0 && (
          <ol aria-label="Curve points" className="flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
            {points.map((p, i) => (
              <li key={p.id}>
                <Button
                  size="sm"
                  variant={p.id === selected ? 'secondary' : 'ghost'}
                  aria-pressed={p.id === selected}
                  onClick={() => choose(p)}
                >
                  Point {i + 1} · {p.u}, {p.v}
                </Button>
              </li>
            ))}
          </ol>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={snapEnabled ? 'secondary' : 'ghost'}
            aria-pressed={snapEnabled}
            onClick={() => {
              setSnapEnabled(!snapEnabled)
              setSnap(null)
            }}
          >
            Snap points
          </Button>
          <Button
            size="sm"
            variant={closed ? 'secondary' : 'ghost'}
            aria-pressed={closed}
            onClick={() => setClosed(!closed)}
          >
            Closed curve
          </Button>
          {selected && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPoints(points.filter((p) => p.id !== selected))
                setSelected(null)
                setU('')
                setV('')
              }}
            >
              Remove point
            </Button>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={submit}>
            Save curve
          </Button>
        </div>
      </div>
    </section>
  )
}
