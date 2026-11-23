/**
 * Shared-bead layout (docs/research/06-freeform.md §5 step 6): one bead in every gap between
 * three mutually adjacent stones, at the point equidistant from their girdles — six per stone in
 * a honeycomb, each holding three stones. Stones on the edge of the field, which have fewer
 * neighbours, get extra beads on their open side until no gap around them exceeds 150°.
 */
import { type Vec3, add, cross, dot, perpendicular, scale, sub } from '../../geometry/vec'
import { RULES } from '../../rules'
import { PointGrid } from '../grid'
import type { PlacedStone } from './layout'

export interface Bead {
  /** On the surface. */
  position: Vec3
  normal: Vec3
  diameter: number
}

/** Neighbours are at most this share of the smaller stone farther apart than touching + gap. */
const NEIGHBOUR_SLACK = 0.5
/** Largest angle around a stone left without a bead. */
const MAX_OPEN_ANGLE = (150 * Math.PI) / 180
/** Beads must not touch each other or sit on a stone's table. */
const CLEARANCE = 0.05

export function layoutBeads(
  stones: readonly PlacedStone[],
  gap: number,
  snap: (q: Vec3) => { p: Vec3; n: Vec3 } | null,
): Bead[] {
  const largest = Math.max(...stones.map((s) => s.diameter))
  const grid = new PointGrid(largest + gap)
  for (const s of stones) grid.add(...(s.position as [number, number, number]))
  const neighbours = stones.map((s, i) => {
    const list: number[] = []
    grid.near(s.position[0], s.position[1], s.position[2], largest + gap + largest * NEIGHBOUR_SLACK, (j, d2) => {
      const o = stones[j]!
      const reach = (s.diameter + o.diameter) / 2 + gap + Math.min(s.diameter, o.diameter) * NEIGHBOUR_SLACK
      if (j !== i && d2 <= reach * reach) list.push(j)
    })
    return list.sort((a, b) => a - b)
  })

  const beads: Bead[] = []
  const beadGrid = new PointGrid(0.6)
  const owners: number[][] = stones.map(() => [])
  const free = (p: Vec3, diameter: number, near: readonly number[]): boolean => {
    for (const j of near) {
      const s = stones[j]!
      const d = Math.hypot(p[0] - s.position[0], p[1] - s.position[1], p[2] - s.position[2])
      if (d < s.diameter / 2 + CLEARANCE) return false
    }
    let ok = true
    beadGrid.near(p[0], p[1], p[2], diameter + CLEARANCE + 0.5, (b) => {
      const o = beads[b]!
      const d = Math.hypot(p[0] - o.position[0], p[1] - o.position[1], p[2] - o.position[2])
      if (d < (diameter + o.diameter) / 2 + CLEARANCE) ok = false
    })
    return ok
  }
  const add3 = (p: Vec3, diameter: number, holds: readonly number[], near: readonly number[]) => {
    const hit = snap(p)
    if (!hit || !free(hit.p, diameter, near)) return
    beadGrid.add(...(hit.p as [number, number, number]))
    for (const h of holds) owners[h]!.push(beads.length)
    beads.push({ position: hit.p, normal: hit.n, diameter })
  }

  // Interstitial beads: one per triangle of mutually adjacent stones.
  stones.forEach((s, i) => {
    const ns = neighbours[i]!
    for (const j of ns) {
      if (j < i) continue
      for (const k of ns) {
        if (k <= j || !neighbours[j]!.includes(k)) continue
        const tri = [i, j, k]
        // Weighting by 1/r pulls the point toward smaller stones, close to equal girdle distance.
        let wsum = 0
        let p: Vec3 = [0, 0, 0]
        for (const t of tri) {
          const w = 2 / stones[t]!.diameter
          p = add(p, scale(stones[t]!.position, w))
          wsum += w
        }
        p = scale(p, 1 / wsum)
        const mean = tri.reduce((sum, t) => sum + stones[t]!.diameter, 0) / 3
        add3(p, RULES.beadDiameter(mean), tri, [...new Set([...ns, ...neighbours[j]!, ...neighbours[k]!, i])])
      }
    }
  })

  // Edge beads where a stone's grip is open on one side.
  stones.forEach((s, i) => {
    const u = perpendicular(s.normal)
    const v = cross(s.normal, u)
    const diameter = RULES.beadDiameter(s.diameter)
    for (let pass = 0; pass < 4; pass++) {
      const angles = owners[i]!
        .map((b) => {
          const d = sub(beads[b]!.position, s.position)
          return Math.atan2(dot(d, v), dot(d, u))
        })
        .sort((a, b) => a - b)
      let widest = angles.length === 0 ? 2 * Math.PI : 0
      let from = 0
      angles.forEach((angle, a) => {
        const gap = (a + 1 < angles.length ? angles[a + 1]! : angles[0]! + 2 * Math.PI) - angle
        if (gap > widest) {
          widest = gap
          from = angle
        }
      })
      if (angles.length >= 3 && widest <= MAX_OPEN_ANGLE) break
      const mid = from + widest / 2
      const dir = add(scale(u, Math.cos(mid)), scale(v, Math.sin(mid)))
      const before = owners[i]!.length
      add3(add(s.position, scale(dir, s.diameter / 2 + diameter * 0.45)), diameter, [i], [...neighbours[i]!, i])
      if (owners[i]!.length === before) break
    }
  })
  return beads
}
