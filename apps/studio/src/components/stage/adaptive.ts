/**
 * Adaptive quality for the 3D views: how sharp to draw and how much the effects may cost, from
 * what this machine has shown it can do. Pure (no WebGL, no DOM), so it is unit-tested, and one
 * owner decides for both the CAD viewport and the Render tab's live preview.
 *
 * The picture has two states:
 *  - still: drawn once and left alone (zero frames while nothing changes), so it can afford the
 *    full pixel ratio, up to a cap that keeps a Retina laptop from drawing four pixels per dot;
 *  - moving (an orbit, a drag, a slider scrub): drawn every frame, so the pixel ratio follows
 *    the measured frame time towards 30 frames a second, and the effects step down only when the
 *    lowest pixel ratio is still too slow.
 *
 * The person picks a Performance mode: Auto (the above), Smooth (always the lighter picture) or
 * Sharp (never reduced; the machine's own pixel ratio, up to 2). What was learned about frame
 * times is kept across gestures, so the second orbit starts at the right level.
 */

export const PERFORMANCE_MODES = ['auto', 'smooth', 'sharp'] as const
export type PerformanceMode = (typeof PERFORMANCE_MODES)[number]

/**
 * How much the effects may cost. `reduced`: fewer internal bounces in the stones and, for a
 * still picture, a smaller studio reflection. `minimal`, for moving pictures only: plain stand-in
 * materials (the clay look) while it moves, the real ones back when it stops: the shapes, quickly.
 */
export type Effects = 'full' | 'reduced' | 'minimal'
const EFFECTS: readonly Effects[] = ['full', 'reduced', 'minimal']

export interface Quality {
  /** Device pixels per CSS pixel the canvas is drawn at. */
  dpr: number
  effects: Effects
}

export interface AdaptiveConfig {
  mode: PerformanceMode
  /** The screen's own pixel ratio (2 on a Retina display). */
  deviceDpr: number
  /** The most the GPU tier is trusted with for a still picture (see ./quality). */
  tierMaxDpr: number
}

/** 30 frames a second: smooth enough to orbit by, and within reach of an integrated GPU. */
export const TARGET_FRAME_MS = 1000 / 30
/** Never below half a device pixel per CSS pixel: lower reads as a broken picture, not a fast one. */
export const MIN_DPR = 0.5
/** Sharp mode's ceiling: past 2 the eye gains nothing and the GPU pays four times over. */
const SHARP_MAX_DPR = 2
/** Auto's ceiling for a still picture on a high-density screen (a Retina laptop). */
export const RETINA_CAP = 1.5
/** Smooth mode's ceilings. */
const SMOOTH_STILL_DPR = 1
const SMOOTH_MOVING_DPR = 0.75
/** Frames slower than the target by this much count as slow; faster than `FAST` as fast. */
const SLOW = 1.15
const FAST = 0.6
/** Consecutive fast frames before the pixel ratio climbs again (falling is immediate). */
const FAST_RUN = 6
/** Consecutive slow frames at the lowest pixel ratio before the effects step down. */
const SLOW_RUN = 4
/** Fast frames in a row (at the lowest effects step) before the effects step back up. */
const RECOVER_RUN = 30
/** A still frame slower than this makes edits draw light first and sharpen after (see stillIsSlow). */
export const SLOW_STILL_MS = 80
/** A gap longer than this is not a frame interval (the tab was hidden, a long task ran). */
const MAX_INTERVAL_MS = 2000

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Pixel ratios move in steps of 1/8, so tiny changes never reallocate the canvas. */
const quantise = (dpr: number) => Math.round(dpr * 8) / 8

/** What a controller learned about this machine, keyed by the settings it was learned under. */
export interface Learned {
  key: string
  movingDpr: number
  movingEffects: Effects
  struggling: boolean
  stillMs: number | null
}

export class AdaptiveQuality {
  #config: AdaptiveConfig
  /** The pixel ratio a moving picture is drawn at, as learned. */
  #movingDpr = 1
  #movingEffects: Effects = 'full'
  /** The machine could not keep up even at the lowest settings: the still picture is lighter too. */
  #struggling = false
  #fastRun = 0
  #slowRun = 0
  #recoverRun = 0
  /** Smoothed cost of a still frame (render to the next frame), or null before one was timed. */
  #stillMs: number | null = null

  constructor(config: AdaptiveConfig) {
    this.#config = config
    this.#reset()
  }

  get mode(): PerformanceMode {
    return this.#config.mode
  }

  /** What was learned, to start the next view of this page (another piece) where this one is. */
  learned(): Learned {
    return {
      key: this.#key(),
      movingDpr: this.#movingDpr,
      movingEffects: this.#movingEffects,
      struggling: this.#struggling,
      stillMs: this.#stillMs,
    }
  }

  /** Starts from what another view learned, when it was learned under the same settings. */
  adopt(l: Learned | null): void {
    if (!l || l.key !== this.#key()) return
    this.#movingDpr = l.movingDpr
    this.#movingEffects = l.movingEffects
    this.#struggling = l.struggling
    this.#stillMs = l.stillMs
  }

  #key(): string {
    const { mode, deviceDpr, tierMaxDpr } = this.#config
    return `${mode}|${deviceDpr}|${tierMaxDpr}`
  }

  /** A new mode, screen or GPU tier: what was learned no longer applies. */
  configure(config: AdaptiveConfig): void {
    const same =
      config.mode === this.#config.mode &&
      config.deviceDpr === this.#config.deviceDpr &&
      config.tierMaxDpr === this.#config.tierMaxDpr
    this.#config = config
    if (!same) this.#reset()
  }

  #reset(): void {
    this.#movingDpr = this.#initialMovingDpr()
    this.#movingEffects = this.#config.mode === 'smooth' ? 'reduced' : 'full'
    this.#struggling = false
    this.#fastRun = this.#slowRun = this.#recoverRun = 0
    this.#stillMs = null
  }

  /** The best still picture the mode allows: what Sharp would draw is the reference. */
  #stillCeiling(): number {
    const { mode, deviceDpr, tierMaxDpr } = this.#config
    const device = Math.max(MIN_DPR, deviceDpr || 1)
    if (mode === 'sharp') return Math.min(device, SHARP_MAX_DPR)
    if (mode === 'smooth') return Math.min(device, SMOOTH_STILL_DPR)
    return Math.min(device, tierMaxDpr, RETINA_CAP)
  }

  #initialMovingDpr(): number {
    const still = this.#stillCeiling()
    if (this.#config.mode === 'sharp') return still
    // A moving picture starts at one pixel per CSS pixel and learns from there.
    return Math.min(still, this.#config.mode === 'smooth' ? SMOOTH_MOVING_DPR : 1)
  }

  /** What to draw when nothing moves. */
  still(): Quality {
    const ceiling = this.#stillCeiling()
    if (this.#config.mode === 'smooth') return { dpr: ceiling, effects: 'reduced' }
    if (this.#struggling) return { dpr: Math.min(ceiling, 1), effects: 'reduced' }
    return { dpr: ceiling, effects: 'full' }
  }

  /** What to draw every frame while something moves. */
  moving(): Quality {
    return { dpr: this.#movingDpr, effects: this.#movingEffects }
  }

  /**
   * The time between two consecutive frames drawn while moving, at the moving quality. Returns
   * true when the moving or still quality changed (the caller resizes the canvas or swaps effects).
   */
  observe(intervalMs: number): boolean {
    if (this.#config.mode === 'sharp') return false
    if (!(intervalMs > 0) || intervalMs > MAX_INTERVAL_MS) return false
    const before = this.moving()
    const stillBefore = this.still()
    const ceiling =
      this.#config.mode === 'smooth'
        ? Math.min(this.#stillCeiling(), SMOOTH_MOVING_DPR)
        : this.#stillCeiling()
    const floorEffects: Effects = this.#config.mode === 'smooth' ? 'reduced' : 'full'

    if (intervalMs > TARGET_FRAME_MS * SLOW) {
      this.#fastRun = 0
      this.#recoverRun = 0
      if (this.#movingDpr > MIN_DPR) {
        // Pixels scale with the square of the ratio: aim straight at the target, in one step
        // of at most 40 % (one bad frame must not crush the picture).
        const k = clamp(Math.sqrt(TARGET_FRAME_MS / intervalMs), 0.6, 0.9)
        this.#movingDpr = clamp(quantise(this.#movingDpr * k), MIN_DPR, ceiling)
      } else {
        // Far too slow (three times the target or worse) steps at once; nearly fast enough
        // waits for a run of slow frames, so one hiccup does not dim the picture.
        this.#slowRun += intervalMs > TARGET_FRAME_MS * 3 ? SLOW_RUN : 1
        if (this.#slowRun < SLOW_RUN) return false
        this.#slowRun = 0
        const i = EFFECTS.indexOf(this.#movingEffects)
        // Already at the lightest effects and still slow: lighten the still picture too.
        if (i < EFFECTS.length - 1) this.#movingEffects = EFFECTS[i + 1]!
        else this.#struggling = true
      }
    } else if (intervalMs < TARGET_FRAME_MS * FAST) {
      this.#slowRun = 0
      if (this.#movingEffects !== floorEffects) {
        if (++this.#recoverRun >= RECOVER_RUN) {
          this.#recoverRun = 0
          this.#struggling = false
          this.#movingEffects = EFFECTS[EFFECTS.indexOf(this.#movingEffects) - 1]!
        }
      } else if (++this.#fastRun >= FAST_RUN && this.#movingDpr < ceiling) {
        this.#fastRun = 0
        this.#movingDpr = clamp(quantise(this.#movingDpr * 1.15), MIN_DPR, ceiling)
      }
    } else {
      this.#fastRun = 0
      this.#slowRun = 0
    }
    const after = this.moving()
    const stillAfter = this.still()
    return (
      after.dpr !== before.dpr ||
      after.effects !== before.effects ||
      stillAfter.dpr !== stillBefore.dpr ||
      stillAfter.effects !== stillBefore.effects
    )
  }

  /** The time from drawing a still frame to the next frame (which waits for the GPU to finish it). */
  observeStill(ms: number): void {
    if (!(ms > 0) || ms > MAX_INTERVAL_MS) return
    this.#stillMs = this.#stillMs === null ? ms : this.#stillMs + 0.3 * (ms - this.#stillMs)
  }

  /**
   * A full still frame is slow on this machine, so an edit is better drawn light at once and
   * sharpened a moment later than drawn sharp after a wait. Never in Sharp, which asks for the
   * full picture every time.
   */
  stillIsSlow(): boolean {
    return this.#config.mode !== 'sharp' && this.#stillMs !== null && this.#stillMs > SLOW_STILL_MS
  }

  /**
   * Whether the picture is below what Sharp would draw, for the quiet indicator: `still` when
   * even the resting picture is lighter, `moving` when only moving pictures are.
   */
  reduction(): { still: boolean; moving: boolean } {
    const sharp = Math.min(Math.max(MIN_DPR, this.#config.deviceDpr || 1), SHARP_MAX_DPR)
    const s = this.still()
    const m = this.moving()
    return {
      still: s.dpr < sharp || s.effects !== 'full',
      moving: m.dpr < sharp || m.effects !== 'full',
    }
  }
}

/** What a view draws now, for the quiet "reduced quality" indicator. */
export interface QualityState {
  mode: PerformanceMode
  /** The still picture is below what Sharp would draw (a Retina cap, lighter effects). */
  reducedStill: boolean
  /** Something is moving and the picture is lighter meanwhile. */
  reducedNow: boolean
  /** Device pixels per CSS pixel, still and while moving. */
  stillDpr: number
  movingDpr: number
  /** The effects drawn now, and those of the still picture. */
  effects: Effects
  stillEffects: Effects
  /**
   * The page should drop its frosted glass for solid fills: Smooth was chosen, or this machine
   * had to lighten the moving picture's effects (it cannot afford a blur on every frame either).
   */
  solidGlass: boolean
}

/** The state of `adaptive` while the view is `light` (moving) or still. */
export function qualityState(adaptive: AdaptiveQuality, light: boolean): QualityState {
  const reduction = adaptive.reduction()
  const still = adaptive.still()
  const moving = adaptive.moving()
  return {
    mode: adaptive.mode,
    reducedStill: reduction.still,
    reducedNow: light && reduction.moving,
    stillDpr: still.dpr,
    movingDpr: moving.dpr,
    effects: light ? moving.effects : still.effects,
    stillEffects: still.effects,
    solidGlass:
      adaptive.mode === 'smooth' || (adaptive.mode === 'auto' && moving.effects !== 'full'),
  }
}

/**
 * Whether two states read the same to a person. The moving pixel ratio is left out: it changes
 * frame by frame during an orbit, and nothing on screen should re-render for that.
 */
export function sameQuality(a: QualityState, b: QualityState): boolean {
  return (
    a.mode === b.mode &&
    a.reducedStill === b.reducedStill &&
    a.reducedNow === b.reducedNow &&
    a.stillDpr === b.stillDpr &&
    a.effects === b.effects &&
    a.stillEffects === b.stillEffects &&
    a.solidGlass === b.solidGlass
  )
}
