import type { EvaluatedCurve } from '@pave/kernel'
import type { Vec3 } from '@pave/render'
import { type CurveCoordinates, type CurvePlane, pointOnCurvePlane } from '@pave/schema'

export const CURVE_SNAP_PX = 12
type Screen = { x: number; y: number }
export type CurveSnap = { point: CurveCoordinates; screen: Screen; label: 'Endpoint' | 'Midpoint' }

export function snapCurve(
  curves: readonly EvaluatedCurve[],
  plane: CurvePlane,
  cursor: Screen,
  project: (world: Vec3) => Screen & { visible: boolean },
): CurveSnap | null {
  let best: CurveSnap | null = null
  let distance = CURVE_SNAP_PX
  const consider = (world: Vec3, label: CurveSnap['label']) => {
    const screen = project(world)
    if (!screen.visible) return
    const next = Math.hypot(screen.x - cursor.x, screen.y - cursor.y)
    if (next >= distance) return
    distance = next
    best = { point: pointOnCurvePlane(plane, world), screen, label }
  }
  for (const curve of curves) {
    if (curve.plane !== plane) continue
    for (const point of curve.points) consider(point, 'Endpoint')
    for (let i = 0; i < curve.points.length - (curve.closed ? 0 : 1); i++) {
      const a = curve.points[i]!
      const b = curve.points[(i + 1) % curve.points.length]!
      consider([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], 'Midpoint')
    }
  }
  return best
}
