/**
 * The look catalogue behind `RenderScene.look`. A look is a declarative light rig, not an HDRI:
 * the same numbers become emissive panels in a three.js PMREM environment and emissive planes
 * in Cycles, so the viewport and the final render see the same studio (research §3, "Define
 * light rigs as shapes in the scene, not as HDRIs").
 *
 * Rigs are camera-relative and scale-free: azimuths are measured from the camera, distances
 * and sizes are in piece radii. A panel's apparent size and radiance — what a polished surface
 * reflects — are then identical for a 6 mm stud and a 60 mm cuff, and the key light stays
 * camera-left whichever preset is chosen. The resolver freezes the rig in world space, so an
 * orbiting camera sees reflections travel as in a real studio.
 *
 * Radiance is linear scene-referred (an emission strength of 1 in Blender, a colour of 1.0 in
 * three.js). Backgrounds are display-referred sRGB because they are composited after tone
 * mapping in both renderers, so "white" is exactly white.
 */
import type { RenderScene } from '@pave/schema'
import type { Rgb } from './color'

export type LookId = RenderScene['look']
export type ViewTransform = 'agx' | 'neutral'

export interface RigPanel {
  id: string
  /** Degrees from the camera direction: 0 = behind the camera, +90 = camera right, 180 = behind the piece. */
  azimuth: number
  elevation: number
  /** Distance from the target, in piece radii. */
  distance: number
  /** Width × height in piece radii; height is the edge closest to world-up. */
  size: [number, number]
  /** Linear radiance at the panel's brightest point; 0 makes a black flag that blocks light. */
  radiance: number
  /** Colour temperature in kelvin; omitted = neutral white. */
  kelvin?: number
  /** Radiance multipliers at the bottom and top edge, for gradient strips. */
  gradient?: [bottom: number, top: number]
  /**
   * Measure elevation from the camera's instead of the horizon, keeping the card on the lens
   * axis at any preset. A black card there stands in for the photographer and lens, whose
   * reflection is what draws a brilliant's dark arrows and contrast pattern.
   */
  followCamera?: boolean
}

export interface RigSparkle {
  count: number
  /** Spread of the lights around the camera azimuth, degrees. */
  spread: number
  elevation: [min: number, max: number]
  /** Distance and disk radius, in piece radii. */
  distance: number
  radius: number
  /** Disk radiance at `RenderScene.sparkle` = 1. */
  radiance: number
}

export type Background =
  | { kind: 'transparent' }
  | { kind: 'solid'; color: Rgb }
  | { kind: 'gradient'; top: Rgb; bottom: Rgb }

export type GroundKind = 'none' | 'shadow' | 'sweep' | 'reflective'

export interface GroundSpec {
  kind: GroundKind
  /** Linear albedo of a sweep or acrylic surface. */
  color: Rgb
  roughness: number
}

export interface Look {
  label: string
  description: string
  view: ViewTransform
  /** Exposure in stops. */
  exposure: number
  panels: RigPanel[]
  /** World radiance by direction: straight up, at the horizon, straight down. */
  ambient: { zenith: number; horizon: number; nadir: number; kelvin?: number }
  background: Background
  ground: GroundSpec
  sparkle: RigSparkle
}

/** Black card on the lens axis (see `followCamera`), about 19° across — a viewer's head. */
const LENS_FLAG: RigPanel = {
  id: 'lens-flag',
  azimuth: 0,
  elevation: 0,
  distance: 6,
  size: [2, 2],
  radiance: 0,
  followCamera: true,
}

const SPARKLE: RigSparkle = {
  count: 6,
  spread: 70,
  elevation: [35, 70],
  distance: 7,
  radius: 0.03,
  radiance: 400,
}

/** Defaults used when the scene asks for a ground the look does not define. */
export const DEFAULT_GROUNDS: Record<GroundKind, GroundSpec> = {
  none: { kind: 'none', color: [0, 0, 0], roughness: 1 },
  shadow: { kind: 'shadow', color: [0, 0, 0], roughness: 1 },
  sweep: { kind: 'sweep', color: [0.75, 0.75, 0.75], roughness: 0.6 },
  // Black acrylic: research §3, roughness 0.05–0.10, IOR 1.49.
  reflective: { kind: 'reflective', color: [0.004, 0.004, 0.004], roughness: 0.06 },
}

export const ACRYLIC_IOR = 1.49

const grey = (v: number): Rgb => [v, v, v]

export const LOOKS: Record<LookId, Look> = {
  'studio-soft': {
    label: 'Studio soft',
    description:
      'A white light tent: overhead softbox, two gradient strips and dark cards for edge definition, on a pale grey gradient. Even, forgiving, true colour.',
    view: 'neutral',
    exposure: 0,
    panels: [
      { id: 'top', azimuth: 0, elevation: 78, distance: 6, size: [5, 5], radiance: 4 },
      {
        id: 'key',
        azimuth: -65,
        elevation: 22,
        distance: 5,
        size: [1.6, 7],
        radiance: 6,
        gradient: [0.3, 1],
      },
      {
        id: 'fill',
        azimuth: 70,
        elevation: 18,
        distance: 5,
        size: [1.6, 7],
        radiance: 4,
        gradient: [0.3, 1],
      },
      { id: 'card-left', azimuth: -30, elevation: 6, distance: 4, size: [1.2, 5], radiance: 0 },
      { id: 'card-right', azimuth: 35, elevation: 6, distance: 4, size: [1.2, 5], radiance: 0 },
      { id: 'card-back', azimuth: 180, elevation: 10, distance: 5, size: [3, 3], radiance: 0 },
      { id: 'front', azimuth: 0, elevation: 2, distance: 7, size: [10, 1.2], radiance: 2.4 },
      LENS_FLAG,
    ],
    // The tent: bright all round, with floor bounce from below (research §3 catalogue white).
    ambient: { zenith: 1.0, horizon: 0.85, nadir: 0.5 },
    background: { kind: 'gradient', top: grey(0.97), bottom: grey(0.86) },
    ground: DEFAULT_GROUNDS.shadow,
    sparkle: SPARKLE,
  },
  'studio-contrast': {
    label: 'Studio contrast',
    description:
      'Hard strips with black flags between them on charcoal: bright metal cut by bold edge lines, punchy stones.',
    view: 'neutral',
    exposure: 0,
    panels: [
      { id: 'top', azimuth: 0, elevation: 75, distance: 6, size: [4, 6], radiance: 7 },
      {
        id: 'key',
        azimuth: -55,
        elevation: 20,
        distance: 5,
        size: [1.8, 7],
        radiance: 9,
        gradient: [0.1, 1],
      },
      {
        id: 'kicker',
        azimuth: 110,
        elevation: 15,
        distance: 5,
        size: [1.4, 7],
        radiance: 6,
        gradient: [0.1, 1],
      },
      { id: 'flag-left', azimuth: -32, elevation: 25, distance: 5, size: [1, 6], radiance: 0 },
      { id: 'flag-right', azimuth: 50, elevation: 25, distance: 5, size: [1, 6], radiance: 0 },
      { id: 'rim', azimuth: 180, elevation: 35, distance: 6, size: [5, 0.8], radiance: 5 },
      {
        id: 'front',
        azimuth: 0,
        elevation: 4,
        distance: 7,
        size: [10, 1.4],
        radiance: 3,
        gradient: [1, 0.3],
      },
      LENS_FLAG,
    ],
    ambient: { zenith: 0.3, horizon: 0.18, nadir: 0.05 },
    background: { kind: 'gradient', top: grey(0.2), bottom: grey(0.07) },
    ground: DEFAULT_GROUNDS.shadow,
    sparkle: { ...SPARKLE, radiance: 600 },
  },
  'black-acrylic': {
    label: 'Black acrylic',
    description:
      'Glossy black acrylic with a mirrored reflection, rim strips from behind and a soft top light.',
    view: 'neutral',
    exposure: 0,
    panels: [
      { id: 'top', azimuth: 180, elevation: 70, distance: 6, size: [7, 5], radiance: 2.2 },
      {
        id: 'side-left',
        azimuth: -80,
        elevation: 20,
        distance: 5,
        size: [2, 7],
        radiance: 2.8,
        gradient: [0.15, 1],
      },
      {
        id: 'side-right',
        azimuth: 80,
        elevation: 20,
        distance: 5,
        size: [2, 7],
        radiance: 2.8,
        gradient: [0.15, 1],
      },
      {
        id: 'rim-left',
        azimuth: -140,
        elevation: 20,
        distance: 5,
        size: [1.2, 6],
        radiance: 3.2,
        gradient: [0.2, 1],
      },
      {
        id: 'rim-right',
        azimuth: 140,
        elevation: 20,
        distance: 5,
        size: [1.2, 6],
        radiance: 3.2,
        gradient: [0.2, 1],
      },
      { id: 'front', azimuth: 0, elevation: 3, distance: 7, size: [8, 1], radiance: 2.5 },
      { id: 'edge-left', azimuth: -16, elevation: 20, distance: 5, size: [0.45, 5], radiance: 4 },
      { id: 'edge-right', azimuth: 20, elevation: 20, distance: 5, size: [0.45, 5], radiance: 3.5 },
      LENS_FLAG,
    ],
    ambient: { zenith: 0.04, horizon: 0.26, nadir: 0 },
    background: { kind: 'gradient', top: grey(0.15), bottom: grey(0.02) },
    ground: DEFAULT_GROUNDS.reflective,
    sparkle: { ...SPARKLE, radiance: 600 },
  },
  daylight: {
    label: 'Daylight',
    description: 'Open sky with a small warm sun: crisp shadow, cool fill, natural and airy.',
    // AgX desaturates gold under a bright sky; Neutral keeps alloys colour-true (research §1).
    view: 'neutral',
    exposure: 0,
    panels: [
      {
        id: 'sun',
        azimuth: -50,
        elevation: 50,
        distance: 12,
        size: [0.5, 0.5],
        radiance: 900,
        kelvin: 5200,
      },
      {
        id: 'window',
        azimuth: 60,
        elevation: 25,
        distance: 6,
        size: [5, 4],
        radiance: 2.5,
        kelvin: 6500,
      },
      LENS_FLAG,
    ],
    ambient: { zenith: 0.8, horizon: 0.55, nadir: 0.3, kelvin: 6800 },
    background: { kind: 'gradient', top: [0.93, 0.95, 0.97], bottom: [0.85, 0.87, 0.88] },
    ground: DEFAULT_GROUNDS.shadow,
    sparkle: { ...SPARKLE, count: 4 },
  },
  'editorial-warm': {
    label: 'Editorial warm',
    description:
      'Tungsten-warm gradient cards on a cream sweep, filmic contrast: magazine and campaign mood.',
    view: 'agx',
    exposure: 0.3,
    panels: [
      {
        id: 'key',
        azimuth: -70,
        elevation: 35,
        distance: 5,
        size: [3, 6],
        radiance: 6,
        kelvin: 3400,
        gradient: [0.15, 1],
      },
      {
        id: 'top',
        azimuth: 20,
        elevation: 80,
        distance: 6,
        size: [4, 4],
        radiance: 3,
        kelvin: 4200,
      },
      {
        id: 'card',
        azimuth: 80,
        elevation: 15,
        distance: 4.5,
        size: [2.5, 6],
        radiance: 2.2,
        kelvin: 3800,
        gradient: [1, 0.15],
      },
      { id: 'flag', azimuth: 25, elevation: 20, distance: 4, size: [2, 5], radiance: 0 },
      LENS_FLAG,
    ],
    ambient: { zenith: 0.35, horizon: 0.25, nadir: 0.08, kelvin: 4000 },
    background: { kind: 'gradient', top: [0.95, 0.9, 0.82], bottom: [0.84, 0.76, 0.66] },
    ground: { kind: 'sweep', color: [0.72, 0.6, 0.46], roughness: 0.7 },
    sparkle: SPARKLE,
  },
  'catalog-white': {
    label: 'Catalogue white',
    description:
      'Pure white background with a soft contact shadow, top softbox, side strips and black cards for crisp metal edges.',
    view: 'neutral',
    exposure: 0,
    panels: [
      { id: 'top', azimuth: 165, elevation: 65, distance: 6, size: [7, 5], radiance: 2.4 },
      {
        id: 'left',
        azimuth: -80,
        elevation: 15,
        distance: 5,
        size: [1.4, 7],
        radiance: 2.8,
        gradient: [0.3, 1],
      },
      {
        id: 'right',
        azimuth: 80,
        elevation: 15,
        distance: 5,
        size: [1.4, 7],
        radiance: 2.8,
        gradient: [0.3, 1],
      },
      { id: 'card-left', azimuth: -35, elevation: 10, distance: 4, size: [1.5, 5], radiance: 0 },
      { id: 'card-right', azimuth: 35, elevation: 10, distance: 4, size: [1.5, 5], radiance: 0 },
      { id: 'front', azimuth: 0, elevation: 2, distance: 7, size: [10, 1.2], radiance: 2.4 },
      { id: 'belt-flag', azimuth: 0, elevation: -16, distance: 4.5, size: [7, 1.6], radiance: 0 },
      LENS_FLAG,
    ],
    ambient: { zenith: 0.92, horizon: 0.72, nadir: 0.55 },
    background: { kind: 'solid', color: grey(1) },
    ground: DEFAULT_GROUNDS.shadow,
    sparkle: SPARKLE,
  },
}

export const LOOK_IDS = Object.keys(LOOKS) as LookId[]
