import type { EvaluatedCurve } from '@pave/kernel'
import type { Vec3 } from '@pave/render'
import type { ViewerPick } from './visibility'

type Point = { x: number; y: number }
type ScreenPoint = Point & { inFront: boolean }

const PICK_RADIUS_PX = 6

/** Picks a visible construction line in CSS pixels after the solid raycast misses. */
export function pickConstructionCurve(
  point: Point,
  curves: readonly EvaluatedCurve[],
  project: (point: Vec3) => ScreenPoint,
  visible: (target: ViewerPick) => boolean,
): ViewerPick | null {
  let closest: ViewerPick | null = null
  let best = PICK_RADIUS_PX ** 2
  for (const { nodeId, points, closed } of curves) {
    const target = { nodeId }
    if (points.length < 2 || !visible(target)) continue
    const first = project(points[0]!)
    let previous = first
    const end = closed ? points.length : points.length - 1
    for (let i = 1; i <= end; i++) {
      const next = i === points.length ? first : project(points[i]!)
      if (previous.inFront && next.inFront) {
        const distance = segmentDistanceSquared(point, previous, next)
        if (distance < best) {
          best = distance
          closest = target
        }
      }
      previous = next
    }
  }
  return closest
}

function segmentDistanceSquared(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
        )
  return (point.x - from.x - fraction * dx) ** 2 + (point.y - from.y - fraction * dy) ** 2
}
