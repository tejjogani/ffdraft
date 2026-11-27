/**
 * Camera presets framed from the piece's bounds. Angles follow research §3 "Camera"; the fill
 * target sits in the 55–75 % band the critique loop checks (§4).
 */
import type { Bounds } from '@pave/kernel/types'
import type { RenderScene } from '@pave/schema'
import {
  add,
  cross,
  dot,
  length,
  lookAtQuat,
  normalize,
  orbitDirection,
  type Quat,
  scale,
  sub,
  type Vec3,
} from './math'
import { boundsCenter, boundsRadius, type SceneSubject, stoneCenter, stoneWidth } from './subject'
import type { ResolvedCamera } from './types'

export type CameraPreset = Exclude<RenderScene['camera']['preset'], 'custom'>

interface PresetSpec {
  azimuth: number
  elevation: number
  /** Fraction of the frame the subject's larger projected side fills. */
  fill: number
  /** `stones` frames the centre stone(s) instead of the whole piece. */
  frame: 'piece' | 'stones'
}

export const CAMERA_PRESETS: Record<CameraPreset, PresetSpec> = {
  hero: { azimuth: 35, elevation: 24, fill: 0.68, frame: 'piece' },
  'three-quarter': { azimuth: 45, elevation: 42, fill: 0.66, frame: 'piece' },
  front: { azimuth: 0, elevation: 10, fill: 0.66, frame: 'piece' },
  side: { azimuth: 90, elevation: 4, fill: 0.66, frame: 'piece' },
  top: { azimuth: 0, elevation: 90, fill: 0.66, frame: 'piece' },
  macro: { azimuth: 28, elevation: 32, fill: 0.62, frame: 'stones' },
}

export const SENSOR_WIDTH_MM = 36

/** Right / up / back (toward the camera) unit vectors of an orbit camera. */
export function cameraBasis(
  azimuth: number,
  elevation: number,
): { right: Vec3; up: Vec3; back: Vec3 } {
  const back = orbitDirection(azimuth, elevation)
  // The orbit rig's pivot X axis is (cos a, sin a, 0) at every elevation, so top views stay upright.
  const a = (azimuth * Math.PI) / 180
  const right: Vec3 = [Math.cos(a), Math.sin(a), 0]
  return { right, up: cross(back, right), back }
}

/**
 * The camera's own right / up / back after its roll: positive roll turns the camera
 * counter-clockwise as seen from behind it, so the picture turns clockwise.
 */
export function rolledBasis(
  azimuth: number,
  elevation: number,
  roll = 0,
): { right: Vec3; up: Vec3; back: Vec3 } {
  const { right, up, back } = cameraBasis(azimuth, elevation)
  if (!roll) return { right, up, back }
  const r = (roll * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { right: add(scale(right, c), scale(up, s)), up: sub(scale(up, c), scale(right, s)), back }
}

export function cameraPose(
  c: Pick<ResolvedCamera, 'target' | 'azimuth' | 'elevation' | 'distance'> & { roll?: number },
): {
  position: Vec3
  quaternion: Quat
} {
  const { up, back } = rolledBasis(c.azimuth, c.elevation, c.roll)
  const position = add(c.target, scale(back, c.distance))
  return { position, quaternion: lookAtQuat(position, c.target, up) }
}

/** Closest a custom camera may stand to its target, as a share of the piece's radius. */
export const MIN_DISTANCE_SHARE = 0.25

/** Elevation a custom camera is held inside: straight up or down has no azimuth to keep. */
export const MAX_ELEVATION = 89.5

/** Orbit angles and distance of a camera standing at `position` and looking at `target`. */
export function orbitOf(
  position: Vec3,
  target: Vec3,
): { azimuth: number; elevation: number; distance: number } {
  const offset = sub(position, target)
  const distance = length(offset)
  const d = normalize(offset)
  const elevation = (Math.asin(Math.max(-1, Math.min(1, d[2]))) * 180) / Math.PI
  // Straight above or below there is no horizontal direction; call it the front.
  const flat = Math.hypot(d[0], d[1]) < 1e-9
  const azimuth = flat ? 0 : (Math.atan2(d[0], -d[1]) * 180) / Math.PI
  return { azimuth, elevation, distance }
}

/**
 * Where a custom camera stands on this piece. On the piece it was framed on (`framedOn` equal
 * to its bounds) that is exactly the stored position and target; on a piece of another size the
 * whole camera scales about the bounds centre, so a house shot frames every piece alike.
 */
export function placeCustom(
  camera: Pick<RenderScene['camera'], 'position' | 'target' | 'framedOn'>,
  center: Vec3,
  radius: number,
): { position: Vec3; target: Vec3 } {
  const target0 = camera.target ?? center
  const position0 = camera.position ?? add(target0, orbitDirection(35, 24))
  const f = camera.framedOn
  if (!f) return { position: position0, target: target0 }
  const same =
    f.radius === radius &&
    f.center[0] === center[0] &&
    f.center[1] === center[1] &&
    f.center[2] === center[2]
  if (same) return { position: position0, target: target0 }
  const k = radius / f.radius
  const move = (p: Vec3): Vec3 => add(center, scale(sub(p, f.center), k))
  return { position: move(position0), target: move(target0) }
}

/** Half-angle tangents of the view, with the sensor width on the larger image side. */
export function viewTangents(focalLength: number, aspect: number): [number, number] {
  const t = SENSOR_WIDTH_MM / 2 / focalLength
  return aspect >= 1 ? [t, t / aspect] : [t * aspect, t]
}

export const corners = (b: Bounds): Vec3[] =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [
    i & 1 ? b.max[0] : b.min[0],
    i & 2 ? b.max[1] : b.min[1],
    i & 4 ? b.max[2] : b.min[2],
  ])

/**
 * Distance and recentred target at which `pts` fill `fill` of the frame. Two passes: frame
 * about their box centre, then shift the target so the projected box is centred and reframe.
 */
export function framePoints(
  pts: readonly Vec3[],
  azimuth: number,
  elevation: number,
  focalLength: number,
  aspect: number,
  fill: number,
): { target: Vec3; distance: number } {
  const { right, up, back } = cameraBasis(azimuth, elevation)
  const [tx, ty] = viewTangents(focalLength, aspect)
  let target = boundsCenter(boundsOf(pts))
  let distance = 0
  for (let pass = 0; pass < 2; pass++) {
    distance = 0
    for (const p of pts) {
      const r = sub(p, target)
      const z = dot(r, back)
      distance = Math.max(
        distance,
        z + Math.abs(dot(r, right)) / (fill * tx),
        z + Math.abs(dot(r, up)) / (fill * ty),
      )
    }
    let lo = [Infinity, Infinity]
    let hi = [-Infinity, -Infinity]
    for (const p of pts) {
      const r = sub(p, target)
      const depth = distance - dot(r, back)
      const u = dot(r, right) / depth
      const v = dot(r, up) / depth
      lo = [Math.min(lo[0]!, u), Math.min(lo[1]!, v)]
      hi = [Math.max(hi[0]!, u), Math.max(hi[1]!, v)]
    }
    const du = ((lo[0]! + hi[0]!) / 2) * distance
    const dv = ((lo[1]! + hi[1]!) / 2) * distance
    target = add(target, add(scale(right, du), scale(up, dv)))
  }
  return { target, distance }
}

function boundsOf(pts: readonly Vec3[]): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of pts)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p[i]!)
      max[i] = Math.max(max[i]!, p[i]!)
    }
  return { min, max }
}

function stoneBounds(subject: SceneSubject): Bounds | null {
  const centre = subject.stones.filter((s) => s.role === 'center')
  const stones = centre.length ? centre : subject.stones
  if (!stones.length) return null
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const s of stones) {
    const c = stoneCenter(s)
    const r = stoneWidth(s) * 0.6
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, c[i]! - r)
      max[i] = Math.max(max[i]!, c[i]! + r)
    }
  }
  return { min, max }
}

/**
 * The table facet of a stone (research §3: focus on the table). The unit gem's table sits
 * about 0.18 girdle widths above the girdle plane, along the stone's local +Z.
 */
function tableOf(s: SceneSubject['stones'][number]): Vec3 {
  const m = s.matrix
  return add(stoneCenter(s), scale([m[8]!, m[9]!, m[10]!], 0.18))
}

/** Where to focus: the named node, else the centre stone's table, else the framing target. */
function focusPoint(subject: SceneSubject, nodeId: string | undefined, fallback: Vec3): Vec3 {
  if (nodeId) {
    const stone = subject.stones.find((s) => s.nodeId === nodeId)
    if (stone) return tableOf(stone)
    const part = subject.parts.find((p) => p.nodeId === nodeId)
    if (part) return boundsCenter(part.bounds)
  }
  const centre = subject.stones.find((s) => s.role === 'center')
  return centre ? tableOf(centre) : fallback
}

export function resolveCamera(
  camera: RenderScene['camera'],
  subject: SceneSubject,
  aspect: number,
  frameReflection = false,
): ResolvedCamera {
  const radius = boundsRadius(subject.bounds)
  let target: Vec3
  let azimuth: number
  let elevation: number
  let distance: number

  if (camera.preset === 'custom' || camera.position) {
    const placed = placeCustom(camera, boundsCenter(subject.bounds), radius)
    target = placed.target
    ;({ azimuth, elevation, distance } = orbitOf(placed.position, target))
    distance = Math.max(distance, radius * MIN_DISTANCE_SHARE)
  } else {
    const spec = CAMERA_PRESETS[camera.preset]
    const stones = spec.frame === 'stones' ? stoneBounds(subject) : null
    const pts = stones ? corners(stones) : (subject.silhouette ?? corners(subject.bounds))
    ;({ azimuth, elevation } = spec)
    if (frameReflection && !camera.target && !stones && elevation < 16) {
      elevation = 16
      if (Math.abs(azimuth) < 15) azimuth = 15
    }
    const framed = framePoints(pts, azimuth, elevation, camera.focalLength, aspect, spec.fill)
    target = camera.target ?? framed.target
    distance = framed.distance
    if (frameReflection && !camera.target && !stones) {
      // A standing piece's reflection needs more space below the contact point.
      const { up } = cameraBasis(azimuth, elevation)
      target = add(
        target,
        scale(up, -0.15 * viewTangents(camera.focalLength, aspect)[1] * distance * up[2]),
      )
    }
  }

  const { position } = cameraPose({ target, azimuth, elevation, distance })
  const forward = orbitDirection(azimuth, elevation)
  const focus = focusPoint(subject, camera.focusNodeId, target)
  return {
    target,
    azimuth,
    elevation,
    distance,
    roll: camera.roll ?? 0,
    focalLength: camera.focalLength,
    sensorWidth: SENSOR_WIDTH_MM,
    focusDistance: Math.max(1, -dot(sub(focus, position), forward)),
    fStop: camera.fStop ?? null,
    near: Math.max(0.05, distance * 0.02),
    far: distance + radius * 200,
  }
}
