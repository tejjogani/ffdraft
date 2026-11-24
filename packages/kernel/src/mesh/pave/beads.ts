/**
 * Shared-bead layout (docs/research/06-freeform.md §5 step 6): one bead in every gap between
 * three mutually adjacent stones, at the point equidistant from their girdles — six per stone in
 * a honeycomb, each holding three stones. Stones on the edge of the field, which have fewer
 * neighbours, get extra beads on their open side until no gap around them exceeds 150°.
 */
import { add, cross, dot, perpendicular, scale, sub, type Vec3 } from '../../geometry/vec'
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
/** Edge beads added per stone at most, and the angle step when searching an open arc for a spot. */
const MAX_EDGE_BEADS = 4
const ARC_STEP = Math.PI / 12

/** The open arcs between bead angles (sorted, radians), widest first; one full turn when none. */
function openArcs(angles: readonly number[]): { from: number; width: number }[] {
  if (angles.length === 0) return [{ from: 0, width: 2 * Math.PI }]
  return angles
    .map((angle, a) => ({
      from: angle,
      width: (a + 1 < angles.length ? angles[a + 1]! : angles[0]! + 2 * Math.PI) - angle,
    }))
    .sort((a, b) => b.width - a.width)
}

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
    grid.near(
      s.position[0],
      s.position[1],
      s.position[2],
      largest + gap + largest * NEIGHBOUR_SLACK,
      (j, d2) => {
        const o = stones[j]!
        const reach =
          (s.diameter + o.diameter) / 2 + gap + Math.min(s.diameter, o.diameter) * NEIGHBOUR_SLACK
        if (j !== i && d2 <= reach * reach) list.push(j)
      },
    )
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
  stones.forEach((_, i) => {
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
        add3(p, RULES.beadDiameter(mean), tri, [
          ...new Set([...ns, ...neighbours[j]!, ...neighbours[k]!, i]),
        ])
      }
    }
  })

  // Edge beads where a stone's grip is open on one side. The middle of the widest open arc is
  // the best spot, but in a single row it is often where the next stone sits: so step round
  // the arc from its middle until a spot is free, then try the next widest arc.
  stones.forEach((s, i) => {
    const u = perpendicular(s.normal)
    const v = cross(s.normal, u)
    const diameter = RULES.beadDiameter(s.diameter)
    const reach = s.diameter / 2 + diameter * 0.45
    // Beads an arc must leave between it and its ends: about a bead's width of angle.
    const keepOff = Math.min(Math.PI / 6, diameter / reach)
    for (let pass = 0; pass < MAX_EDGE_BEADS; pass++) {
      const angles = owners[i]!.map((b) => {
        const d = sub(beads[b]!.position, s.position)
        return Math.atan2(dot(d, v), dot(d, u))
      }).sort((a, b) => a - b)
      const arcs = openArcs(angles)
      if (angles.length >= 3 && arcs[0]!.width <= MAX_OPEN_ANGLE) break
      let placed = false
      for (const arc of arcs) {
        if (arc.width <= MAX_OPEN_ANGLE && angles.length >= 3) break
        const half = arc.width / 2 - (angles.length > 0 ? keepOff : 0)
        for (let k = 0; !placed && k * ARC_STEP <= half; k++)
          for (const sign of k === 0 ? [1] : [1, -1]) {
            const angle = arc.from + arc.width / 2 + sign * k * ARC_STEP
            const dir = add(scale(u, Math.cos(angle)), scale(v, Math.sin(angle)))
            const before = owners[i]!.length
            add3(add(s.position, scale(dir, reach)), diameter, [i], [...neighbours[i]!, i])
            if (owners[i]!.length > before) {
              placed = true
              break
            }
          }
        if (placed) break
      }
      if (!placed) break
    }
  })
  return beads
}
