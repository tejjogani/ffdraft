/**
 * The data of a reference match (docs/plans/reference-match.md §12). Everything is plain data on
 * typed arrays so a fit can run in Node, a Worker or the browser and its inputs can be stored.
 *
 * Conventions: millimetres, right-handed, Z up. A ring's finger axis is Y and its head is at +Z;
 * flat pieces face −Y. Image coordinates are pixels, x to the right and y down, with (0, 0) at the
 * top-left corner of the top-left pixel.
 */
import type { Diagnostic, Evaluation } from '@pave/kernel/types'
import type { Design, Op, RingSize } from '@pave/schema'

export type { Diagnostic, Evaluation }

/** The caller's kernel. `@pave/match` never creates one. */
export type Evaluate = (design: Design, signal?: AbortSignal) => Promise<Evaluation>
export type Vec3 = [number, number, number]
export interface Size {
  width: number
  height: number
}

/**
 * A pinhole camera without a focal length: photos are cropped, so only the image scale (`span`)
 * and the strength of perspective (`distance`) mean anything.
 */
export interface Camera {
  /** Degrees. 0 looks from −Y (the front); 90 looks from +X. */
  azimuth: number
  /** Degrees, −90..90. 90 looks straight down. */
  elevation: number
  /** Degrees, turns the image counter-clockwise as seen by the viewer. */
  roll: number
  /** mm from the camera to `target`; perspective only. */
  distance: number
  /** mm across the larger image side at the target's depth: the image scale. */
  span: number
  /** Principal-point offset, as fractions of the larger image side. */
  shift: [number, number]
  target: Vec3
}

/** One rendered view: a class, node, and optionally depth and face index per pixel. */
export interface LabelRaster {
  width: number
  height: number
  /** 0 background, 1 metal, 2 stone. */
  cls: Uint8Array
  /** Index + 1 into `nodeIds`; 0 = none. */
  node: Uint16Array
  nodeIds: string[]
  /** Camera depth in mm; Infinity where nothing was drawn. */
  depth?: Float32Array
  /** Triangle index in drawing order (see `triangleAt`); −1 where nothing was drawn. */
  face?: Int32Array
}

/** A stone seen in an image: centre and girdle diameter, in pixels. */
export interface StoneMark {
  x: number
  y: number
  d: number
}

/** What a photo is reduced to before fitting. The benchmark makes these from kernel renders. */
export interface TargetView {
  id: string
  width: number
  height: number
  /** Subject matte, 0 or 1 per pixel. */
  matte: Uint8Array
  /** Union of stone instances, 0 or 1 per pixel. */
  stones?: Uint8Array
  /** Named regions (head, band, body) and the nodes that should cover them. */
  parts?: { key: string; mask: Uint8Array; nodeIds: string[] }[]
  marks?: StoneMark[]
  /** From the read's view label; tried first by the pose search. */
  seed?: { azimuth: number; elevation: number }
  /** mm across the larger side, from a reference object; holds the camera's span. */
  spanMm?: number
  /** Scored, never fitted. */
  heldOut?: boolean
}

/** Image moments of a mask, as fractions of the image (area of the whole, centroid of the side). */
export interface Moments {
  area: number
  cx: number
  cy: number
}

/** A target with its distance maps precomputed. Opaque to callers. */
export interface Prepared {
  view: TargetView
  moments: Moments
  edge: Uint8Array
  edgeDist: Float32Array
  stoneEdge: Uint8Array
  stoneEdgeDist: Float32Array
  hasStones: boolean
  /** A copy with the larger side at 96 px, for the pose search; null when already that small. */
  small: Prepared | null
}

export interface ViewScore {
  loss: number
  iou: number
  stoneIou: number | null
  /** Mean outline distance, both ways, in pixels. */
  edgePx: number
  edgeMm: number
  stoneEdgePx: number | null
  parts: { key: string; iou: number; edgePx: number }[]
  /** Reported, never in the loss. */
  marks: { matched: number; missing: number; extra: number; meanPx: number } | null
}

/** One free number: `${nodeId}.${field path}`, as in the canon's RECIPE_PARAMS. */
export interface FitParam {
  key: string
  nodeId: string
  path: string[]
  min: number
  max: number
  /** The field's own step; the search stops below max(step, 0.02 mm). */
  step: number
  start: number
  /** Keys set to the same value (`band.widthBottom` follows `band.widthTop`). */
  tie?: string[]
  pinned?: boolean
  integer?: boolean
  snap?: 'melee'
}

export type ParamStatus = 'fitted' | 'assumed' | 'pinned' | 'clamped'

export interface FitInput {
  design: Design
  params: FitParam[]
  views: TargetView[]
  evaluate: Evaluate
  /** Known cameras by view id; the others are searched. */
  cameras?: Record<string, Camera>
  /** Node ids left out of rendering (pavé, chain). */
  hide?: string[]
  /** Defaults: 250 evaluations and 60,000 ms. The evaluation count is deterministic; time is a cap. */
  budget?: { evaluations?: number; ms?: number }
  signal?: AbortSignal
  onProgress?: (r: FitResult) => void
}

export interface FitResult {
  design: Design
  /** Ops that turn the input design into `design`. */
  ops: Op[]
  cameras: Record<string, Camera>
  scores: Record<string, ViewScore>
  /** Mean loss over the fitted views. */
  loss: number
  params: { key: string; value: number; status: ParamStatus; sensitivity: number }[]
  evaluations: number
  rasters: number
  stopped: 'converged' | 'budget' | 'aborted'
  diagnostics: Diagnostic[]
}

export type ScaleAnchor =
  | { type: 'ringSize'; nodeId: string; size: RingSize }
  | { type: 'stone'; nodeId: string; carat?: number; widthMm?: number }
  | { type: 'height'; nodeId: string; mm: number }
  /** `side`: the larger side of that view in pixels, needed to turn the mark into a span. */
  | { type: 'reference'; viewId: string; mark: StoneMark; diameterMm: number; side: number }
  | { type: 'assumed' }

export interface Question {
  field: string
  options: string[]
  /** Larger is more consequential; see `rankQuestions`. */
  consequence: number
  why: string
}

export interface CameraSteps {
  /** Degrees, for azimuth, elevation and roll. */
  angle: number
  /** Natural-log step of span; 0 holds it. */
  logSpan: number
  /** Fraction of the larger side; 0 holds it. */
  shift: number
  /** Natural-log step of distance; 0 or absent holds it. */
  logDistance?: number
}

/** Counters threaded through internal calls so a result can report its own cost. */
export interface Stats {
  rasters: number
}
