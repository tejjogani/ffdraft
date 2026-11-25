/**
 * The two linked measures the inspector edits on behalf of a field: a stone's size in mm and
 * carats (carats are never stored — only the girdle width is), and a ring's size in the
 * designer's preferred system (the node is rewritten only when a value is picked).
 */
import {
  type GemCutId,
  type GemMaterialId,
  gemCarat,
  gemDims,
  gemDimsFromCarat,
  type RingSize,
  type RingSizeSystem,
  ringInnerDiameter,
  ringSizeFromDiameter,
  snapToMelee,
} from '@pave/schema'

export interface StoneSpec {
  cut: GemCutId
  stone: GemMaterialId
  lw?: number
}

/** The nearest multiple of `step`, as the decimal it reads as (3.26, not 3.2600000000000002). */
const round = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(6))

/** Estimated carat of one stone of girdle width `width`. */
export const caratOf = (s: StoneSpec, width: number): number =>
  gemCarat(s.cut, gemDims(s.cut, width, s.lw), s.stone)

/** The girdle width (mm, to 0.01) of a stone of `carat`, clamped to [min, max]. */
export function widthForCarat(s: StoneSpec, carat: number, min: number, max: number): number {
  const w = gemDimsFromCarat(s.cut, carat, s.stone, s.lw).width
  return Math.min(max, Math.max(min, round(w, 0.01)))
}

/** Melee sizes are bought as calibrated parcels: a width snaps to the nearest stock size. */
export const snapWidth = (width: number, snap: 'melee' | undefined): number =>
  snap === 'melee' ? snapToMelee(width) : width

// ── Ring sizes ───────────────────────────────────────────────────────────────────────────────

/** The sizes offered in a system, smallest first (mm is typed, not picked). */
export function sizeOptions(system: Exclude<RingSizeSystem, 'mm'>): RingSize[] {
  const range: Record<typeof system, [number, number, number]> = {
    us: [2, 16, 0.25],
    uk: [0, 30, 0.5],
    eu: [41, 76, 0.5],
    jp: [1, 30, 1],
  }
  const [from, to, step] = range[system]
  const out: RingSize[] = []
  for (let v = from; v <= to + 1e-9; v += step) out.push({ system, value: round(v, step) })
  return out
}

/**
 * How `size` reads in `system`: itself when the systems match, else the nearest size in
 * `system` (charts disagree by up to half a size, so it is marked approximate) and how far the
 * finger size would move (mm of inner diameter) if that size were picked.
 */
export function inSystem(
  size: RingSize,
  system: RingSizeSystem,
): { size: RingSize; approx: boolean; deltaMm: number } {
  if (size.system === system) return { size, approx: false, deltaMm: 0 }
  const d = ringInnerDiameter(size)
  const converted = ringSizeFromDiameter(d, system)
  return { size: converted, approx: true, deltaMm: ringInnerDiameter(converted) - d }
}
