/** Detail control: a 0–1 slider mapped to Manifold's tolerance-bounded edge collapse. */
import type { Manifold } from 'manifold-3d'

/**
 * Surface deviation per unit of "less detail", relative to the body height: detail 0.5 allows
 * 0.15 % of the height (≈0.06 mm on a 40 mm pendant — below casting resolution), detail 0.1
 * about 1.4 %, capped at 2 % so the silhouette always survives.
 */
const DEVIATION_PER_STEP = 0.0015
const MAX_DEVIATION = 0.02

export function simplifyToDetail(m: Manifold, detail: number, height: number): Manifold {
  if (detail >= 1) return m
  const tolerance = Math.min(DEVIATION_PER_STEP * (1 / Math.max(detail, 1e-3) - 1), MAX_DEVIATION) * height
  return m.simplify(tolerance)
}
