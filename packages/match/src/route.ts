/**
 * The per-part ladder (plan §4): the lowest-freedom feature that explains the region. Every
 * threshold is a starting value for the `route` suite to calibrate; none is measured yet.
 */
export const ROUTE_THRESHOLDS = {
  /** Part overlap at or above which the recipe's node is kept. */
  iou: 0.9,
  /** Stone overlap at or above which, where stones were looked for, the node is kept. */
  stoneIou: 0.5,
  /** Mean outline distance, as a fraction of the part's size, at or below which it is kept. */
  edgeFraction: 0.03,
  /** A generated mesh registered to the photo must overlap the matte this much. */
  meshOverlap: 0.85,
  /** Real photos needed before a generated mesh is considered. */
  meshViews: 2,
} as const

export function routePart(i: {
  iou: number
  edgeMm: number
  sizeMm: number
  flat: boolean
  realViews: number
  meshOverlap?: number
  /** Stone overlap where the photo's stones were looked for (an empty stone mask counts). */
  stoneIou?: number | null
}): { route: 'parametric' | 'outline' | 'relief' | 'mesh'; reason: string } {
  const T = ROUTE_THRESHOLDS
  const stones =
    i.stoneIou === undefined || i.stoneIou === null ? '' : `, stones ${i.stoneIou.toFixed(2)}`
  const fit = `overlap ${i.iou.toFixed(2)}${stones}, edges ${i.edgeMm.toFixed(2)} mm on ${i.sizeMm.toFixed(1)} mm`
  const stonesOk = i.stoneIou === undefined || i.stoneIou === null || i.stoneIou >= T.stoneIou
  if (i.iou >= T.iou && stonesOk && i.edgeMm <= T.edgeFraction * i.sizeMm)
    return { route: 'parametric', reason: `The recipe explains it (${fit}).` }
  if (i.flat)
    return {
      route: 'outline',
      reason: `Flat and the recipe misses it (${fit}): traced from the outline.`,
    }
  if (i.realViews >= T.meshViews && (i.meshOverlap ?? 0) >= T.meshOverlap)
    return {
      route: 'mesh',
      reason: `The generated mesh overlaps the photo by ${(i.meshOverlap ?? 0).toFixed(2)}.`,
    }
  const why =
    i.realViews < T.meshViews
      ? `${i.realViews} real view${i.realViews === 1 ? '' : 's'} is too few for a generated mesh`
      : i.meshOverlap === undefined
        ? 'no generated mesh yet'
        : `the generated mesh overlaps only ${i.meshOverlap.toFixed(2)}`
  return {
    route: 'relief',
    reason: `The recipe misses it (${fit}) and ${why}: relief, depth as a hint.`,
  }
}
