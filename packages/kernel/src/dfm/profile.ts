/**
 * A manufacturer profile: the thresholds the whole-piece checks compare against, in mm unless
 * noted. Defaults are a Stuller-like caster (docs/research/01-cad.md §2, 02-production.md §2–3);
 * every value can be overridden for a specific caster or printer.
 */
import { RULES } from '../rules'

export interface DfmProfile {
  /** Metal left beside a pavé, channel or flush seat (Stuller: channel wall ≥ 0.40). */
  seatWall: number
  /** Fraction of a stone's volume that may sit in metal (prong bite, bezel lip) before it is unseated. */
  stoneInMetal: number
  /** Bail opening must exceed the chain's width by this much (06-freeform.md §6: + 1.5 mm). */
  bailClearance: number
  /** Bail wire: wall ≥ 1.0 mm (06-freeform.md §6). */
  bailWire: number
  /** Earring posts are Ø 0.8–0.9 mm (01-cad.md §2); thinner ones bend in the ear. */
  postWire: { warn: number; error: number }
  /** Jump rings and clasp eyes: claws and small parts ≥ 0.5 mm, ≥ 0.8 mm when loaded (02-production §3). */
  ringWire: number
  /** Chain wire below this is too fine to cast reliably (print floor 0.5 mm, 02-production §3). */
  chainWire: number
  /** Accent-stone prong diameter by stone size (JewelCraft presets via RULES). */
  accentProng: (stoneWidth: number) => number
  /** Shells smaller than this are casting slivers, not metal (mm³). */
  fragment: number
  /** Polygon limit of the strictest common bureau (Shapeways: 1 M). */
  maxTriangles: number
  /** Upload limit for the STL, MB (Cooksongold: 50 MB). */
  maxStlMegabytes: number
  /** Metal weight above which a piece is almost certainly mis-sized (g). */
  maxMetalG: number
  /** Largest piece a caster takes, sorted smallest to largest (Cooksongold: 30 × 50 × 70 mm). */
  envelope: [number, number, number]
}

export const DEFAULT_PROFILE: DfmProfile = {
  seatWall: RULES.channelWall,
  stoneInMetal: 0.08,
  bailClearance: 1.5,
  bailWire: 1.0,
  postWire: { warn: 0.8, error: 0.6 },
  ringWire: 0.5,
  chainWire: 0.5,
  accentProng: RULES.accentProng,
  fragment: 0.05,
  maxTriangles: 1_000_000,
  maxStlMegabytes: 50,
  envelope: [30, 50, 70],
  maxMetalG: 1000,
}

/** The default profile with some values replaced. */
export const profileWith = (overrides: Partial<DfmProfile>): DfmProfile => ({
  ...DEFAULT_PROFILE,
  ...overrides,
})
