import type { EvaluatedCurve } from '@pave/kernel'
import type { Vec3 } from '@pave/render'
import { useEffect, useState } from 'react'
import type { Viewer } from '../../../components/stage/viewer'

/** The overlays use the same projection as the CAD camera and redraw only with it. */
export function useProjection(viewer: Viewer | null): void {
  const [, setFrame] = useState(0)
  useEffect(() => viewer?.onRender(() => setFrame((frame) => frame + 1)), [viewer])
}

export function curvePath(viewer: Viewer, points: Vec3[], closed?: boolean): string {
  const projected = points.map((p) => viewer.project(p))
  let path = ''
  for (let i = 1; i < projected.length; i++) {
    const a = projected[i - 1]!
    const b = projected[i]!
    if (a.inFront && b.inFront) path += `M${a.x} ${a.y}L${b.x} ${b.y}`
  }
  const a = projected.at(-1)
  const b = projected[0]
  if (closed && a?.inFront && b?.inFront) path += `M${a.x} ${a.y}L${b.x} ${b.y}`
  return path
}

export function CurveOverlay({
  viewer,
  curves,
  selected,
}: {
  viewer: Viewer | null
  curves: readonly EvaluatedCurve[]
  selected: readonly string[]
}) {
  useProjection(viewer)
  useEffect(() => {
    viewer?.setConstructionFrame(curves)
  }, [viewer, curves])
  if (!viewer || !curves.length) return null

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full">
      {curves.map((curve) => {
        const path = curvePath(viewer, curve.points, curve.closed)
        if (!path) return null
        const active = selected.includes(curve.nodeId)
        return (
          <g key={curve.nodeId} data-construction-curve={curve.nodeId}>
            <path
              d={path}
              fill="none"
              strokeWidth={active ? 2.5 : 1.25}
              className={active ? 'stroke-select' : 'cad-construction-guide'}
            />
          </g>
        )
      })}
    </svg>
  )
}
