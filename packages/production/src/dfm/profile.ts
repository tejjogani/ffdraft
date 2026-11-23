/**
 * Manufacturer profiles: every design-for-manufacture threshold as data. Defaults are the
 * "DFM checks" table in docs/research/02-production.md (Decisions), itself drawn from
 * Cooksongold, Stuller, Materialise, Shapeways and Formlabs guidance; most are one vendor's rule,
 * so every value is overridable per manufacturer.
 */
export interface ManufacturerProfile {
  id: string
  name: string
  /** Largest part the caster accepts, mm (compared sorted, so orientation is free). */
  envelopeMm: [number, number, number]
  /** Warn when any part extent is smaller than this (hard to sprue and handle). */
  minExtentMm: number
  maxFileMb: number
  maxTriangles: number
  wall: { errorMm: number; warnMm: number; ringShankWarnMm: number }
  prong: { errorMm: number; warnMm: number; longWarnMm: number; longRatio: number }
  bezelWallMm: number
  channelWallMm: number
  beadMm: { min: number; max: number }
  paveBorderWarnMm: number
  opening: { errorMm: number; warnMm: number }
  recessedText: { minWidthMm: number; maxDepthMm: number; maxDepthToWidth: number }
  raisedText: { minWidthMm: number; maxHeightMm: number }
  /** High-polish surfaces lose 0.1–0.2 mm; walls below this get a warning. */
  polishWallWarnMm: number
  seatGirdlePct: { min: number; max: number }
  hollow: { accepted: boolean; minShellMm: number; minHoleMm: number }
  /** Bureaus scale for shrinkage themselves (Cooksongold), so Pavé sends nominal geometry. */
  casterCompensatesShrinkage: boolean
  weightTolerancePct: number
  /** Sprue, button and melt allowance added to net metal for the order weight. */
  castingAllowancePct: number
  /** QC tolerances printed on the spec sheet (research §1, QC row). */
  tolerances: { ringSize: string; ringIdMm: number; dimensionalPct: number; dimensionalFloorMm: number }
}

export const DEFAULT_PROFILE: ManufacturerProfile = {
  id: 'pave-default',
  name: 'Pavé default (lost-wax casting bureau)',
  envelopeMm: [30, 50, 70],
  minExtentMm: 2.4,
  maxFileMb: 50,
  maxTriangles: 1_000_000,
  wall: { errorMm: 0.5, warnMm: 0.8, ringShankWarnMm: 1.0 },
  prong: { errorMm: 0.45, warnMm: 0.5, longWarnMm: 0.8, longRatio: 3 },
  bezelWallMm: 0.45,
  channelWallMm: 0.4,
  beadMm: { min: 0.4, max: 0.5 },
  paveBorderWarnMm: 0.5,
  opening: { errorMm: 0.3, warnMm: 0.4 },
  recessedText: { minWidthMm: 0.3, maxDepthMm: 0.5, maxDepthToWidth: 1 },
  raisedText: { minWidthMm: 0.3, maxHeightMm: 0.6 },
  polishWallWarnMm: 1.0,
  seatGirdlePct: { min: 90, max: 98 },
  hollow: { accepted: true, minShellMm: 0.7, minHoleMm: 2 },
  casterCompensatesShrinkage: true,
  weightTolerancePct: 5,
  castingAllowancePct: 12,
  tolerances: { ringSize: '+1/4 / −1/8 size', ringIdMm: 0.05, dimensionalPct: 5, dimensionalFloorMm: 0.15 },
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] }
export type ProfileInput = DeepPartial<ManufacturerProfile>

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function merge<T>(base: T, over: unknown): T {
  if (!isPlain(over) || !isPlain(base)) return (over === undefined ? base : over) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) if (v !== undefined) out[k] = merge((base as Record<string, unknown>)[k], v)
  return out as T
}

export const resolveProfile = (input?: ProfileInput): ManufacturerProfile => merge(DEFAULT_PROFILE, input)
