/**
 * One wall reading: how much metal lies behind a surface point, measured along the inward
 * normal. Shared by the kernel's `wall.thin` check (each node's exact bodies) and
 * @pave/production's thickness report (the fused casting), so both read walls the same way.
 * Pure arithmetic over a ray query the caller supplies: no WASM, safe to import anywhere.
 *
 * Two things make a naive "first face the ray leaves through" reading wrong:
 *
 *  - Overlapping shells. A body may hold shells that overlap or touch (a bail's loop and its
 *    collar, two faces 0.001 mm apart). The ray leaves the inner shell at once but is still in
 *    metal. The wall ends where the winding number, counted back from infinity, drops to zero.
 *  - Edges. Near a sharp or tangent convex edge the ray leaves through the face on the far side
 *    of the edge after a few hundredths of a millimetre: a 45° cone rim reads 0.00 mm. That is
 *    an edge, which casts, not a wall. A plate or a wire is read between faces that oppose each
 *    other; when the exit face does not oppose the sample's face, the reading is repeated a
 *    little away from the edge, and only a reading that stays thin there is a wall (a feather
 *    edge stays thin for a millimetre and more; a cone rim does not).
 */

export type Vec3 = readonly [number, number, number]

/** One surface the ray crosses: `w` +1 entering metal, −1 leaving; `normal` outward, unit. */
export interface WallCrossing {
  t: number
  w: number
  normal: Vec3
}

/** Every crossing of the ray o + t·d for t > 0, any order. */
export type WallRay = (origin: Vec3, direction: Vec3) => WallCrossing[]

/** Faces whose normals are within this of opposite bound a plate or a wire (about 20°). */
const OPPOSED = -0.94
/** Ignore crossings this close to the start: the sample's own face. */
const SELF = 1e-4

/**
 * Where the ray, starting on or just inside the surface, finally leaves the metal: the first
 * exit after which nothing further is entered and left again with metal in between. The
 * winding beyond a crossing is minus the sum of the `w` after it, so this needs no knowledge
 * of where the ray started (on the surface, between two coincident shells, slightly outside).
 */
export function exitOf(crossings: WallCrossing[]): WallCrossing | null {
  const sorted = [...crossings].sort((a, b) => a.t - b.t)
  let beyond = 0
  let exit: WallCrossing | null = null
  for (let i = sorted.length - 1; i >= 0; i--) {
    const c = sorted[i]!
    // Outside after c (nothing beyond adds up to metal) and c leaves metal: a candidate.
    if (c.t > SELF && c.w < 0 && beyond === 0) exit = c
    beyond += c.w
  }
  return exit
}

/**
 * The wall behind the surface point `p` with outward unit normal `n`, in mm: Infinity when the
 * ray never leaves metal. A reading under `limit` that is only an edge is returned as at least
 * `limit`, so callers that compare with `limit` do not count it.
 */
export function wallAt(ray: WallRay, p: Vec3, n: Vec3, limit: number): number {
  const inward: Vec3 = [-n[0], -n[1], -n[2]]
  const exit = exitOf(ray(p, inward))
  if (!exit) return Number.POSITIVE_INFINITY
  if (exit.t >= limit) return exit.t
  const e = exit.normal
  const facing = e[0] * n[0] + e[1] * n[1] + e[2] * n[2]
  if (facing < OPPOSED) return exit.t
  // The exit face's normal, projected on the sample's tangent plane, points toward the edge
  // the two faces meet at. Step away from it by twice the limit and read again.
  const tx = e[0] - facing * n[0]
  const ty = e[1] - facing * n[1]
  const tz = e[2] - facing * n[2]
  const length = Math.hypot(tx, ty, tz)
  if (length === 0) return exit.t
  const step = (2 * limit) / length
  const q: Vec3 = [p[0] - tx * step, p[1] - ty * step, p[2] - tz * step]
  // Beside the edge the reading is the wall itself (the reading at the edge only measures how
  // close the sample was to it), so a confirmed reading reports the larger of the two.
  const beside = exitOf(ray(q, inward))
  if (beside && beside.t < limit) return Math.max(exit.t, beside.t)
  return Math.max(limit, beside?.t ?? Number.POSITIVE_INFINITY)
}

/**
 * A reading as people see it, to 0.01 mm. Limits are compared with this, not the raw reading:
 * a 0.5 mm wire tessellates to 0.4999 mm, which must neither print as "0.50 mm thin" next to a
 * 0.5 mm limit nor be called thin at all.
 */
export const shownMm = (value: number): number => Math.round(value * 100) / 100
