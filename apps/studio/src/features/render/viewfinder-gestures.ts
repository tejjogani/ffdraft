/**
 * The viewfinder's gestures as pure functions of the pose, so mouse, trackpad, touch and keys
 * all move the camera the same way and the rules are tested without a browser:
 *
 *  - drag: orbit; shift-drag or right/middle drag: pan; alt-drag sideways: roll;
 *  - wheel or trackpad pinch: closer and further;
 *  - two fingers: pinch to come closer, move to pan, twist to roll;
 *  - keys move the camera: arrows orbit (shift: finer), alt or ctrl+arrows pan, + and −
 *    closer and further, [ and ] roll.
 */

import type { Evaluation } from '@pave/kernel'
import {
  dollyBy,
  type Framing,
  orbitBy,
  panBy,
  predictFraming,
  rollBy,
  subjectOf,
  type Vec3,
  type ViewPose,
} from '@pave/render'

/** Degrees of orbit per pixel dragged. */
export const ORBIT_PER_PX = 0.35
/** Degrees of roll per pixel dragged sideways with alt. */
export const ROLL_PER_PX = 0.25

export type DragMode = 'orbit' | 'pan' | 'roll'

export function dragModeOf(e: { button: number; shiftKey: boolean; altKey: boolean }): DragMode {
  if (e.button === 1 || e.button === 2 || e.shiftKey) return 'pan'
  if (e.altKey) return 'roll'
  return 'orbit'
}

/**
 * A one-pointer drag of `dx`, `dy` CSS pixels over a frame `width`×`height`. Orbit: dragging
 * right turns the piece's front to the right, dragging down shows it from higher. Pan: the
 * piece follows the pointer. Roll: dragging right turns the picture clockwise.
 */
export function drag(
  p: ViewPose,
  mode: DragMode,
  dx: number,
  dy: number,
  width: number,
  height: number,
): ViewPose {
  if (mode === 'orbit') return orbitBy(p, -dx * ORBIT_PER_PX, dy * ORBIT_PER_PX)
  if (mode === 'pan') return panBy(p, -dx / width, dy / height, width / height)
  return rollBy(p, dx * ROLL_PER_PX)
}

/** A wheel step: positive `deltaY` (scroll down, pinch in) moves away. */
export const wheel = (p: ViewPose, deltaY: number): ViewPose =>
  dollyBy(p, Math.exp(Math.max(-200, Math.min(200, deltaY)) * 0.002))

export interface Touch2 {
  /** Midpoint, distance between the fingers and the angle of the line between them (rad). */
  mid: [number, number]
  span: number
  angle: number
}

export function touchOf(a: [number, number], b: [number, number]): Touch2 {
  return {
    mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    span: Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])),
    angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
  }
}

/** Two fingers from `from` to `to`: spread to come closer, move to pan, twist to roll. */
export function pinch(
  p: ViewPose,
  from: Touch2,
  to: Touch2,
  width: number,
  height: number,
): ViewPose {
  let twist = ((to.angle - from.angle) * 180) / Math.PI
  if (twist > 180) twist -= 360
  if (twist < -180) twist += 360
  const moved = drag(p, 'pan', to.mid[0] - from.mid[0], to.mid[1] - from.mid[1], width, height)
  // Screen y points down, so a clockwise twist has a growing angle: the picture turns with it.
  return rollBy(dollyBy(moved, from.span / to.span), twist)
}

/** A key press, or null when the key is not one of the viewfinder's. */
export function key(
  p: ViewPose,
  e: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  aspect: number,
): ViewPose | null {
  const step = e.shiftKey ? 1 : 5
  const pan = e.altKey || e.ctrlKey
  const share = e.shiftKey ? 0.01 : 0.04
  switch (e.key) {
    // Keys move the camera: left takes it round to the left, up raises it.
    case 'ArrowLeft':
      return pan ? panBy(p, -share, 0, aspect) : orbitBy(p, -step, 0)
    case 'ArrowRight':
      return pan ? panBy(p, share, 0, aspect) : orbitBy(p, step, 0)
    case 'ArrowUp':
      return pan ? panBy(p, 0, share, aspect) : orbitBy(p, 0, step)
    case 'ArrowDown':
      return pan ? panBy(p, 0, -share, aspect) : orbitBy(p, 0, -step)
    case '+':
    case '=':
      return dollyBy(p, e.shiftKey ? 0.98 : 0.92)
    case '-':
    case '_':
      return dollyBy(p, e.shiftKey ? 1.02 : 1.08)
    case '[':
      return rollBy(p, -(e.shiftKey ? 5 : 1))
    case ']':
      return rollBy(p, e.shiftKey ? 5 : 1)
    default:
      return null
  }
}

/**
 * The points the overlay frames: every metal vertex (thinned to a few thousand) and the stones'
 * support points, so the predicted box follows the true outline, not the bounding box.
 */
export function framingPoints(e: Evaluation, budget = 6000): Vec3[] {
  const total = e.parts.reduce((n, part) => n + part.mesh.positions.length / 3, 0)
  const stride = Math.max(1, Math.ceil(total / budget))
  const pts: Vec3[] = []
  for (const part of e.parts) {
    const pos = part.mesh.positions
    for (let i = 0; i < pos.length / 3; i += stride)
      pts.push([pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!])
  }
  pts.push(...(subjectOf(e).silhouette ?? []))
  return pts
}

export const framingOf = (p: ViewPose, aspect: number, points: readonly Vec3[]): Framing =>
  predictFraming(p, aspect, points)
