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
export function cameraBasis(azimuth: number, elevation: number): { right: Vec3; up: Vec3; back: Vec3 } {
  const back = orbitDirection(azimuth, elevation)
  // The orbit rig's pivot X axis is (cos a, sin a, 0) at every elevation, so top views stay upright.
  const a = (azimuth * Math.PI) / 180
  const right: Vec3 = [Math.cos(a), Math.sin(a), 0]
  return { right, up: cross(back, right), back }
}

export function cameraPose(c: Pick<ResolvedCamera, 'target' | 'azimuth' | 'elevation' | 'distance'>): {
  position: Vec3
  quaternion: Quat
} {
  const { up, back } = cameraBasis(c.azimuth, c.elevation)
  const position = add(c.target, scale(back, c.distance))
  return { position, quaternion: lookAtQuat(position, c.target, up) }
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
      distance = Math.max(distance, z + Math.abs(dot(r, right)) / (fill * tx), z + Math.abs(dot(r, up)) / (fill * ty))
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

/** Where to focus: the named node, else the centre stone's table, else the framing target. */
function focusPoint(subject: SceneSubject, nodeId: string | undefined, fallback: Vec3): Vec3 {
  if (nodeId) {
    const stone = subject.stones.find((s) => s.nodeId === nodeId)
    if (stone) return stoneCenter(stone)
    const part = subject.parts.find((p) => p.nodeId === nodeId)
    if (part) return boundsCenter(part.bounds)
  }
  const centre = subject.stones.find((s) => s.role === 'center')
  return centre ? stoneCenter(centre) : fallback
}

export function resolveCamera(
  camera: RenderScene['camera'],
  subject: SceneSubject,
  aspect: number,
): ResolvedCamera {
  const radius = boundsRadius(subject.bounds)
  let target: Vec3
  let azimuth: number
  let elevation: number
  let distance: number

  if (camera.preset === 'custom' || camera.position) {
    target = camera.target ?? boundsCenter(subject.bounds)
    const offset = sub(camera.position ?? add(target, orbitDirection(35, 24)), target)
    distance = Math.max(length(offset), radius * 0.5)
    const d = normalize(offset)
    elevation = (Math.asin(Math.max(-1, Math.min(1, d[2]))) * 180) / Math.PI
    azimuth = (Math.atan2(d[0], -d[1]) * 180) / Math.PI
  } else {
    const spec = CAMERA_PRESETS[camera.preset]
    const stones = spec.frame === 'stones' ? stoneBounds(subject) : null
    const pts = stones ? corners(stones) : (subject.silhouette ?? corners(subject.bounds))
    ;({ azimuth, elevation } = spec)
    const framed = framePoints(pts, azimuth, elevation, camera.focalLength, aspect, spec.fill)
    target = camera.target ?? framed.target
    distance = framed.distance
  }

  const { position } = cameraPose({ target, azimuth, elevation, distance })
  const forward = orbitDirection(azimuth, elevation)
  const focus = focusPoint(subject, camera.focusNodeId, target)
  return {
    target,
    azimuth,
    elevation,
    distance,
    focalLength: camera.focalLength,
    sensorWidth: SENSOR_WIDTH_MM,
    focusDistance: Math.max(1, -dot(sub(focus, position), forward)),
    fStop: camera.fStop ?? null,
    near: Math.max(0.05, distance * 0.02),
    far: distance + radius * 200,
  }
}
