/**
 * Metal appearance — the only place these numbers live. Values are docs/research/03-rendering.md
 * §2 "Metals": base colour is normal-incidence reflectance (linear sRGB) and the edge tint is the
 * F82 reflectance, which is exactly what Blender's Metallic BSDF (F82 mode) takes. three.js has
 * no edge tint; it uses `color` with `metalness: 1` and Schlick's F0→1 ramp, which differs from
 * F82 only near grazing angles.
 *
 * Rows marked *est* in the research are provisional until measured against physical swatches.
 */
import type { FinishId, MetalId, PlatingId } from '@pave/schema'
import type { Rgb } from '../color'

export interface MetalAppearance {
  color: Rgb
  edgeTint: Rgb
}

const metal = (color: Rgb, edgeTint: Rgb): MetalAppearance => ({ color, edgeTint })

const YELLOW_18K = metal([0.98, 0.75, 0.47], [0.98, 0.98, 0.99])
const ROSE_18K = metal([0.97, 0.68, 0.48], [0.98, 0.98, 0.97])

export const METAL_APPEARANCE: Record<MetalId, MetalAppearance> = {
  'au24k-yellow': metal([1.0, 0.766, 0.336], [0.97, 1.0, 0.98]),
  'au22k-yellow': metal([1.0, 0.76, 0.4], [0.97, 0.99, 0.99]),
  'au18k-yellow': YELLOW_18K,
  // Unplated white gold is warm (research: low confidence); most designs set rhodium plating.
  'au18k-white': metal([0.67, 0.61, 0.52], [0.85, 0.86, 0.88]),
  'au18k-rose': ROSE_18K,
  'au14k-yellow': metal([0.97, 0.76, 0.52], [0.98, 0.97, 0.99]),
  'au14k-white': metal([0.68, 0.63, 0.54], [0.85, 0.86, 0.88]),
  'au14k-rose': metal([0.96, 0.67, 0.51], [0.98, 0.97, 0.97]),
  // 10k and 9k extrapolate the 18k → 14k trend toward the paler Ag/Cu master alloy (*est*).
  'au10k-yellow': metal([0.95, 0.77, 0.56], [0.98, 0.97, 0.98]),
  'au10k-white': metal([0.69, 0.645, 0.56], [0.85, 0.86, 0.88]),
  'au9k-yellow': metal([0.94, 0.77, 0.58], [0.98, 0.97, 0.98]),
  pt950: metal([0.72, 0.68, 0.63], [0.79, 0.82, 0.85]),
  pt900: metal([0.715, 0.675, 0.625], [0.79, 0.82, 0.85]),
  pd950: metal([0.733, 0.697, 0.652], [0.83, 0.85, 0.89]),
  'ag925-sterling': metal([0.95, 0.93, 0.88], [0.99, 0.99, 1.0]),
  'ag999-fine': metal([0.989, 0.984, 0.978], [0.99, 0.99, 1.0]),
  'ti-grade5': metal([0.542, 0.497, 0.449], [0.77, 0.79, 0.82]),
  // Physically Based (CC0) brass.
  brass: metal([0.887, 0.789, 0.434], [0.97, 0.97, 0.95]),
}

/** A plating replaces the visible surface; `none` shows the base alloy. */
export const PLATING_APPEARANCE: Record<PlatingId, MetalAppearance | null> = {
  none: null,
  rhodium: metal([0.8, 0.77, 0.745], [0.81, 0.82, 0.84]),
  'black-rhodium': metal([0.23, 0.23, 0.22], [0.6, 0.6, 0.6]),
  // Vermeil is ≥ 10k gold over silver; trade vermeil is usually plated at 18k–24k colour.
  'yellow-vermeil': YELLOW_18K,
  'rose-vermeil': ROSE_18K,
}

/**
 * Procedural surface relief, in mm so it is scale-true on every piece. `cells` is a hammered
 * dimple field (Voronoi), `grain` a sandblast bump.
 */
export interface Relief {
  kind: 'cells' | 'grain'
  sizeMm: number
  strength: number
}

export interface FinishAppearance {
  roughness: number
  /** 0–1; brushed metal streaks along the brush direction. */
  anisotropy: number
  relief: Relief | null
}

/** Research §2 finish table, mid-range of each row. */
export const FINISH_APPEARANCE: Record<FinishId, FinishAppearance> = {
  polished: { roughness: 0.045, anisotropy: 0, relief: null },
  satin: { roughness: 0.27, anisotropy: 0, relief: null },
  brushed: { roughness: 0.32, anisotropy: 0.75, relief: null },
  matte: { roughness: 0.55, anisotropy: 0, relief: { kind: 'grain', sizeMm: 0.035, strength: 0.15 } },
  hammered: { roughness: 0.1, anisotropy: 0, relief: { kind: 'cells', sizeMm: 1.5, strength: 0.4 } },
}

/**
 * Brushed pieces are brushed around an axis: for rings that is the finger (+Y in the design
 * space), so the streaks run around the band.
 */
export const BRUSH_AXIS: [number, number, number] = [0, 1, 0]
