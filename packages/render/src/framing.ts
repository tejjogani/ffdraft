/**
 * The viewfinder's maths, pure so the browser preview, the Blender take and the assistant all
 * move and judge a camera the same way:
 *
 *  - `projectPoint` / `predictFraming`: where the piece lands in the output frame, before any
 *    render ("62% · good"), with the same bands the numeric critique measures a take by;
 *  - `customCamera`, `orbitBy`, `panBy`, `dollyBy`, `rollBy`: a custom camera (position,
 *    target, lens, roll) and the moves a person makes with mouse, trackpad, touch or keys;
 *  - `sceneHash`: a fingerprint of the exact resolved scene a take renders.
 */
import type { RenderScene } from '@pave/schema'
import { CHECKS } from './assess'
import {
  cameraPose,
  MAX_ELEVATION,
  MIN_DISTANCE_SHARE,
  orbitOf,
  rolledBasis,
  viewTangents,
} from './camera'
import { add, dot, scale, sub, type Vec3 } from './math'
import type { ResolvedCamera } from './types'

type CameraFields = Pick<
  ResolvedCamera,
  'target' | 'azimuth' | 'elevation' | 'distance' | 'roll' | 'focalLength'
>

/**
 * Where a point lands in the output frame: 0–1 from the top-left (y down), or null behind the
 * camera. The sensor width spans the larger image side, as in both renderers.
 */
export function projectPoint(c: CameraFields, aspect: number, p: Vec3): [number, number] | null {
  const { right, up, back } = rolledBasis(c.azimuth, c.elevation, c.roll)
  const { position } = cameraPose(c)
  const r = sub(p, position)
  const depth = -dot(r, back)
  if (depth <= 1e-6) return null
  const [tx, ty] = viewTangents(c.focalLength, aspect)
  const x = dot(r, right) / depth / tx
  const y = dot(r, up) / depth / ty
  return [(x + 1) / 2, (1 - y) / 2]
}

export type FramingVerdict =
  | 'good'
  | 'small'
  | 'large'
  | 'tight'
  | 'cropped'
  | 'off-centre'
  | 'empty'

export interface Framing {
  /** The piece's box in the frame, 0–1 from the top-left; null when nothing is in front. */
  box: [number, number, number, number] | null
  /** Share of the frame the box's larger side fills (as the critique measures it). */
  fill: number
  verdict: FramingVerdict
  /** e.g. "62% · good". */
  label: string
}

const VERDICT_WORDS: Record<FramingVerdict, string> = {
  good: 'good',
  small: 'small',
  large: 'large',
  tight: 'tight to the edge',
  cropped: 'cropped',
  'off-centre': 'off-centre',
  empty: 'not in view',
}

/**
 * The framing a take will have, from the piece's points (its vertices, or the support points the
 * resolver frames presets by). The bands are the critique's (`CHECKS`), so "good" here is what
 * the numeric pass would accept.
 */
export function predictFraming(c: CameraFields, aspect: number, points: Iterable<Vec3>): Framing {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let behind = false
  for (const p of points) {
    const q = projectPoint(c, aspect, p)
    if (!q) {
      behind = true
      continue
    }
    x0 = Math.min(x0, q[0])
    y0 = Math.min(y0, q[1])
    x1 = Math.max(x1, q[0])
    y1 = Math.max(y1, q[1])
  }
  if (!Number.isFinite(x0) || x1 < 0 || y1 < 0 || x0 > 1 || y0 > 1)
    return { box: null, fill: 0, verdict: 'empty', label: VERDICT_WORDS.empty }
  const fill = Math.max(x1 - x0, y1 - y0)
  const margin = Math.min(x0, y0, 1 - x1, 1 - y1)
  const offset = Math.hypot((x0 + x1) / 2 - 0.5, (y0 + y1) / 2 - 0.5)
  const verdict: FramingVerdict =
    behind || margin <= 0.002
      ? 'cropped'
      : fill > CHECKS.fill[1]
        ? 'large'
        : margin < CHECKS.minMargin
          ? 'tight'
          : fill < CHECKS.fill[0]
            ? 'small'
            : offset > CHECKS.maxCentreOffset
              ? 'off-centre'
              : 'good'
  const clip = (v: number) => Math.min(1, Math.max(0, v))
  return {
    box: [clip(x0), clip(y0), clip(x1), clip(y1)],
    fill,
    verdict,
    label: `${Math.round(fill * 100)}% · ${VERDICT_WORDS[verdict]}`,
  }
}

/** A custom camera as the scene stores it. */
export type CustomCamera = Required<
  Pick<RenderScene['camera'], 'position' | 'target' | 'roll' | 'focalLength'>
>

/** The live pose a viewfinder moves: the orbit form of a camera, plus what bounds it. */
export interface ViewPose extends CameraFields {
  /** The piece's radius (mm): bounds how close the camera may come and how far a pan goes. */
  radius: number
}

export function poseOf(c: CameraFields, radius: number): ViewPose {
  return {
    target: c.target,
    azimuth: c.azimuth,
    elevation: c.elevation,
    distance: c.distance,
    roll: c.roll,
    focalLength: c.focalLength,
    radius,
  }
}

const wrap = (deg: number) => {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180
  return d === -180 ? 180 : d
}
const round = (v: number, places = 3) => Math.round(v * 10 ** places) / 10 ** places
const roundVec = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])]

/** Turns the camera about its target (degrees); elevation stops short of straight up or down. */
export function orbitBy(p: ViewPose, dAzimuth: number, dElevation: number): ViewPose {
  return {
    ...p,
    azimuth: wrap(p.azimuth + dAzimuth),
    elevation: Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, p.elevation + dElevation)),
  }
}

/**
 * Slides camera and target together across the picture, by shares of the frame's width and
 * height (positive x moves the view right, so the piece moves left; positive y moves it up).
 */
export function panBy(p: ViewPose, dx: number, dy: number, aspect: number): ViewPose {
  const { right, up } = rolledBasis(p.azimuth, p.elevation, p.roll)
  const [tx, ty] = viewTangents(p.focalLength, aspect)
  const move = add(scale(right, dx * 2 * tx * p.distance), scale(up, dy * 2 * ty * p.distance))
  return { ...p, target: add(p.target, move) }
}

/** Moves the camera toward (factor < 1) or away from (> 1) its target. */
export function dollyBy(p: ViewPose, factor: number): ViewPose {
  const min = p.radius * MIN_DISTANCE_SHARE
  return { ...p, distance: Math.max(min, Math.min(p.radius * 400, p.distance * factor)) }
}

export function rollBy(p: ViewPose, degrees: number): ViewPose {
  return { ...p, roll: wrap(p.roll + degrees) }
}

/**
 * The scene patch that stores a pose as a custom camera. `framedOn` records the piece it was
 * framed on, so the same shot reused on another piece scales with it. Values are rounded to
 * microns and thousandths of a degree: what is stored is what both renderers draw.
 */
export function customCameraPatch(
  p: ViewPose,
  framedOn: { center: Vec3; radius: number },
  basePreset?: RenderScene['camera']['basePreset'],
): { camera: Record<string, unknown> } {
  const { position } = cameraPose(p)
  return {
    camera: {
      preset: 'custom',
      position: roundVec(position),
      target: roundVec(p.target),
      roll: round(p.roll),
      focalLength: p.focalLength,
      framedOn: { center: framedOn.center, radius: framedOn.radius },
      ...(basePreset ? { basePreset } : {}),
    },
  }
}

/** The patch that puts a custom camera back on its preset. */
export function resetCameraPatch(camera: RenderScene['camera']): {
  camera: Record<string, unknown>
} {
  return {
    camera: {
      preset: camera.basePreset ?? (camera.preset === 'custom' ? 'hero' : camera.preset),
      position: null,
      target: null,
      roll: null,
      framedOn: null,
      basePreset: null,
    },
  }
}

/** A camera at `position` looking at `target` (e.g. the CAD view), as a pose. */
export function poseFromLookAt(
  position: Vec3,
  target: Vec3,
  focalLength: number,
  radius: number,
  roll = 0,
): ViewPose {
  const o = orbitOf(position, target)
  return { target, ...o, roll, focalLength, radius }
}

/** A camera in plain words for the assistant: angles, distance and where it stands. */
export function describePose(c: CameraFields & { position?: Vec3 }): string {
  const position = c.position ?? cameraPose(c).position
  const v = (x: Vec3) => `[${x.map((n) => round(n, 2)).join(', ')}]`
  return `azimuth ${round(c.azimuth, 1)}°, elevation ${round(c.elevation, 1)}°, ${round(c.distance, 1)} mm from the target, roll ${round(c.roll, 1)}°, lens ${c.focalLength} mm; position ${v(position)}, target ${v(c.target)}`
}

/**
 * JSON with sorted keys, so equal scenes give equal text whatever order their keys came in.
 * With `places`, numbers are rounded to that many decimals first.
 */
export function canonicalJson(value: unknown, places?: number): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v, places)).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v, places)}`)
      .join(',')}}`
  if (typeof value === 'number' && places !== undefined && Number.isFinite(value))
    // `+ 0` turns −0 into 0.
    return JSON.stringify(Number(value.toFixed(places)) + 0)
  return JSON.stringify(value)
}

/**
 * Decimals the fingerprint keeps (a nanometre, in mm). The browser and Node can differ in the
 * last bit of a sine (measured: one sparkle light 1e-14 mm apart), which no render can show.
 */
const HASH_PLACES = 6

/** cyrb53 with a seed: a fast 53-bit string hash, the same in every browser and in Node. */
function cyrb53(s: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/**
 * Fingerprint of what a take renders: the resolved scene (every number both renderers use) and
 * the design version it was resolved from. An identity check, not a security hash: the same
 * fingerprint means the same picture is asked for, and with the fixed seed Blender gives the
 * same pixels on the same machine. Numbers are compared to a nanometre (`HASH_PLACES`).
 */
export function sceneHash(resolved: unknown, design: { pieceId: string; version: number }): string {
  const text = canonicalJson({ design, resolved }, HASH_PLACES)
  return `${cyrb53(text, 0)}${cyrb53(text, 0x9e3779b9)}`
}
