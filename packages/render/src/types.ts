/**
 * The resolved job: everything a renderer needs, with every number explicit. It is the contract
 * between `resolveScene` and both backends (three.js and `workers/render/pave_render.py`), so it
 * is plain JSON — no defaults, no ids to look up, no renderer-specific fields.
 *
 * Space is the Evaluation's: millimetres, right-handed, Z up.
 */
import type { Rgb } from './color'
import type { Background, LookId, ViewTransform } from './looks'
import type { ResolvedMaterial } from './materials'
import type { Quat, Vec3 } from './math'

export const RESOLVED_SCENE_VERSION = 1

/**
 * The camera is an orbit rig: a pivot at `target` turned by azimuth (about Z) and elevation,
 * with the camera `distance` mm out along the pivot's −Y, looking back at it. Both renderers
 * build that hierarchy, so animating azimuth sweeps a true arc rather than a chord.
 */
export interface ResolvedCamera {
  target: Vec3
  azimuth: number
  elevation: number
  distance: number
  /** 35 mm-equivalent focal length; the sensor width applies to the larger image side. */
  focalLength: number
  sensorWidth: number
  focusDistance: number
  /** null = no depth of field. */
  fStop: number | null
  near: number
  far: number
}

/** An emissive rectangle. It emits along its local −Z; local +Y is its "height" edge. */
export interface ResolvedPanel {
  id: string
  position: Vec3
  quaternion: Quat
  size: [number, number]
  /** Linear radiance (colour × intensity); 0 = black flag. */
  radiance: Rgb
  /** Multipliers at the local −Y and +Y edges, interpolated linearly. */
  gradient: [number, number]
}

/** A small spherical light that only gems see — the source of fire and scintillation. */
export interface ResolvedSparkle {
  position: Vec3
  radius: number
  /** Radiant intensity: irradiance at distance d mm is `intensity / d²` (radiance units). */
  intensity: Rgb
}

export interface ResolvedRig {
  /** The rig turns about the vertical axis through `pivot` (environment rotation, light sweep). */
  pivot: Vec3
  rotation: number
  panels: ResolvedPanel[]
  sparkles: ResolvedSparkle[]
  /** World radiance straight up, at the horizon and straight down, interpolated linearly in z. */
  ambient: { zenith: Rgb; horizon: Rgb; nadir: Rgb }
}

export type ResolvedGround =
  | { kind: 'none' }
  | { kind: 'shadow'; z: number; size: number }
  /** Seamless sweep: `profile` is [depth, height] pairs in the sweep's frame, extruded `width` wide. */
  | {
      kind: 'sweep'
      z: number
      /** The sweep faces the camera: its wall is on the far side, rotated by this azimuth. */
      azimuth: number
      center: Vec3
      profile: [number, number][]
      width: number
      color: Rgb
      roughness: number
    }
  | { kind: 'reflective'; z: number; size: number; color: Rgb; roughness: number; ior: number }

export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'

/** `ease` shapes the segment that starts at this key (cubic, as Blender's CUBIC easing). */
export interface Keyframe {
  frame: number
  value: number
  ease: Ease
}

export type TrackTarget =
  | 'pieceRotation'
  | 'rigRotation'
  | 'cameraAzimuth'
  | 'cameraElevation'
  | 'cameraDistance'
  | 'focusDistance'

export interface ResolvedAnimation {
  fps: number
  /** Frames 0 … frameCount − 1 are rendered. A loop's last key sits at `frameCount`. */
  frameCount: number
  loop: boolean
  tracks: Partial<Record<TrackTarget, Keyframe[]>>
}

export interface ResolvedOutput {
  width: number
  height: number
  samples: number
  noiseThreshold: number
  bounces: { total: number; transmission: number; glossy: number; diffuse: number; transparent: number }
  clampDirect: number
  clampIndirect: number
  filterGlossy: number
  denoise: boolean
  seed: number
}

export interface ResolvedScene {
  version: typeof RESOLVED_SCENE_VERSION
  look: LookId
  /** Bounds centre and half-diagonal (mm): the scale for clip planes, shadows and capture. */
  subject: { center: Vec3; radius: number }
  color: { view: ViewTransform; exposure: number }
  camera: ResolvedCamera
  rig: ResolvedRig
  background: Background
  ground: ResolvedGround
  /** Materials by key, and which key each part / stone id uses. */
  materials: Record<string, ResolvedMaterial>
  assignments: Record<string, string>
  animation: ResolvedAnimation | null
  output: ResolvedOutput
}
