import {
  type NodeOf,
  type NurbsControlPoint,
  sameJson,
  sampleNurbs,
  withNurbsPoint,
} from '@pave/schema'
import { Button, Dialog, NumberField, Select } from '@pave/ui'
import { PencilRuler } from 'lucide-react'
import { type PointerEvent, useMemo, useRef, useState } from 'react'
import type { DesignSession } from '../../../lib/design-session/store'

type Curve = NodeOf<'nurbsCurve'>
const planes = { front: [0, 2], top: [0, 1], right: [1, 2] } as const
type Plane = keyof typeof planes
type XYZ = [number, number, number]

function range(points: NurbsControlPoint[], axis: number) {
  const values = points.map((p) => p[axis]!)
  return [Math.min(...values), Math.max(...values)] as const
}

function defaultPlane(curve: Curve): Plane {
  const widths = [0, 1, 2].map((i) => {
    const [min, max] = range(curve.controlPoints, i)
    return max - min
  })
  if (widths[2]! <= Math.min(widths[0]!, widths[1]!)) return 'top'
  return widths[0]! < widths[1]! ? 'right' : 'front'
}

export function NurbsControls({
  node,
  session,
  readOnly,
  pieceId,
}: {
  node: Curve
  session: DesignSession | null
  readOnly: boolean
  pieceId: string
}) {
  const [edit, setEdit] = useState<{ original: Curve; version: number } | null>(null)
  return (
    <section aria-label="NURBS curve" className="space-y-2 border-b border-line px-4 py-3">
      <p className="text-xs text-fg-muted">
        Degree {node.degree} · {node.controlPoints.length} control points
        {node.rhinoLayer && <> · {node.rhinoLayer}</>}
      </p>
      {!readOnly && session && (
        <Button
          size="sm"
          icon={PencilRuler}
          onClick={() => setEdit({ original: node, version: session.get().version })}
        >
          Edit control points
        </Button>
      )}
      {edit && !readOnly && session && (
        <ControlEditor
          original={edit.original}
          onClose={() => setEdit(null)}
          onSave={(points) => {
            const current = session.get()
            const n = current.view.nodes[node.id]
            if (
              current.pieceId !== pieceId ||
              current.version !== edit.version ||
              current.pending.length ||
              current.gesture ||
              n?.kind !== 'nurbsCurve' ||
              !sameJson(n.controlPoints, edit.original.controlPoints)
            )
              throw Error(
                'The design changed. Reopen the control points to edit the latest version.',
              )
            const options = { label: 'Edited NURBS control points', baseVersion: edit.version }
            session.commit(
              [{ t: 'update', id: node.id, patch: { controlPoints: points } }],
              options,
            )
            setEdit(null)
          }}
        />
      )}
    </section>
  )
}

function ControlEditor({
  original,
  onClose,
  onSave,
}: {
  original: Curve
  onClose: () => void
  onSave: (points: NurbsControlPoint[]) => void
}) {
  const [plane, setPlane] = useState<Plane>(() => defaultPlane(original))
  const [points, setPoints] = useState(original.controlPoints)
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState('')
  const drag = useRef<{ index: number; start: DOMPoint; point: NurbsControlPoint } | null>(null)
  const [u, v] = planes[plane]
  const frame = useMemo(() => {
    const [left, right] = range(original.controlPoints, u),
      [bottom, top] = range(original.controlPoints, v)
    const scale = Math.min(350 / Math.max(right - left, 0.1), 175 / Math.max(top - bottom, 0.1))
    return { midX: (left + right) / 2, midY: (bottom + top) / 2, scale }
  }, [original, u, v])
  const project = (p: XYZ | NurbsControlPoint) =>
    [200 + (p[u] - frame.midX) * frame.scale, 110 - (p[v] - frame.midY) * frame.scale] as const
  const samples = useMemo(
    () => sampleNurbs({ ...original, controlPoints: points }),
    [points, original],
  )
  const change = (index: number, p: NurbsControlPoint) => {
    setError('')
    setPoints((prev) => withNurbsPoint({ ...original, controlPoints: prev }, index, p))
  }
  const svgPoint = (e: PointerEvent<SVGElement>) => {
    const svg =
      e.currentTarget instanceof SVGSVGElement ? e.currentTarget : e.currentTarget.ownerSVGElement
    const matrix = svg?.getScreenCTM()
    return matrix ? new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse()) : null
  }
  const values = points[selected]!
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit control points"
      description="Choose a point on the control polygon. Drag it in this view or enter its project coordinates in millimetres."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={sameJson(points, original.controlPoints)}
            onClick={() => {
              try {
                onSave(points)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            Save points
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select
          aria-label="Control point view"
          value={plane}
          onChange={setPlane}
          options={[
            { value: 'front', label: 'Front · X / Z' },
            { value: 'top', label: 'Top · X / Y' },
            { value: 'right', label: 'Right · Y / Z' },
          ]}
        />
        <svg
          viewBox="0 0 400 220"
          aria-label="Curve and control polygon"
          role="img"
          className="w-full touch-none rounded-md border border-line bg-bg-subtle"
          onPointerMove={(e) => {
            const active = drag.current
            if (!active) return
            const at = svgPoint(e)
            if (!at) return
            const p = [...active.point] as NurbsControlPoint
            p[u] += (at.x - active.start.x) / frame.scale
            p[v] -= (at.y - active.start.y) / frame.scale
            if (Math.abs(p[u]) <= 1e7 && Math.abs(p[v]) <= 1e7) change(active.index, p)
          }}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
        >
          <title>Curve and control polygon</title>
          <polyline
            points={points.map((p) => project(p).join(',')).join(' ')}
            fill="none"
            stroke="currentColor"
            opacity=".4"
            strokeDasharray="3 3"
          />
          <polyline
            points={samples.map((p) => project(p).join(',')).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          {points.map((p, i) => {
            const [cx, cy] = project(p)
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={i === selected ? 5 : 3.5}
                className="cursor-grab fill-bg stroke-fg"
                strokeWidth={i === selected ? 3 : 1.5}
                aria-label={`Control point ${i + 1}`}
                onPointerDown={(e) => {
                  setSelected(i)
                  const at = svgPoint(e)
                  if (at) {
                    drag.current = { index: i, start: at, point: p }
                    e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId)
                  }
                }}
              />
            )
          })}
        </svg>
        <div className="grid grid-cols-[40%_1fr] items-center gap-2 text-sm">
          <NumberField
            rowLabel="Point number"
            aria-label="Point number"
            value={selected + 1}
            min={1}
            max={points.length}
            step={1}
            onChange={(n) => {
              if (n !== null && Number.isInteger(n) && n >= 1 && n <= points.length)
                setSelected(n - 1)
            }}
          />
          {(['X', 'Y', 'Z', 'Weight'] as const).map((label, i) => (
            <NumberField
              key={label}
              rowLabel={label}
              aria-label={`Control point ${label}`}
              value={values[i]!}
              step={i === 3 ? 0.001 : 0.01}
              precision={6}
              min={i === 3 ? 1e-12 : -1e7}
              max={i === 3 ? 1e12 : 1e7}
              unit={i === 3 ? undefined : 'mm'}
              onChange={(n) => {
                if (n !== null && Number.isFinite(n) && (i !== 3 || n > 0)) {
                  const p = [...values] as NurbsControlPoint
                  p[i] = n
                  change(selected, p)
                }
              }}
            />
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
