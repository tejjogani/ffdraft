import { measureRhinoRoleBody as measureMesh } from '@pave/kernel/rhino-role-measurements'
import type { GemCutId } from '@pave/schema'

export function measureRhinoRoleBody(
  stl: ArrayBuffer,
  cut: GemCutId,
  rotation?: [number, number, number],
) {
  return measureMesh(new Uint8Array(stl), cut, { rotation })
}

/** Flag a widely separated working copy only when the other occurrences have a typical spacing. */
export function isolatedStoneIds(
  points: readonly { id: string; girdle: readonly [number, number, number] }[],
): Set<string> {
  const result = new Set<string>()
  if (points.length < 5) return result
  const nearest = points.map(({ girdle: a }, i) => {
    let min = Infinity
    for (const [j, { girdle: b }] of points.entries())
      if (i !== j) min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))
    return min
  })
  const distances = nearest.toSorted((a, b) => a - b)
  const median = distances[Math.floor(distances.length * 0.5)]!
  if (!Number.isFinite(median) || median < 1e-5) return result
  const upper = distances[Math.floor(distances.length * 0.75)]!
  const lower = distances[Math.floor(distances.length * 0.25)]!
  const cutoff = Math.max(median * 2, upper + 3 * (upper - lower))
  nearest.forEach((d, i) => {
    if (d > cutoff) result.add(points[i]!.id)
  })
  return result
}
