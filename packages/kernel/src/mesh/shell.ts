/**
 * Hollowing to a wall thickness. The cavity is the inward offset of the body by `wall` (a level
 * set of its distance field). On a flat-backed piece the offset is taken from the body *before*
 * the back was sliced off, so the cavity runs out through the flat back: the classic scooped
 * hip-hop back with a rim of `wall` all round. A body without a flat back gets a closed hollow
 * and two Ø2 mm escape holes through the back, per docs/research/02-production.md (hollows:
 * escape holes 4 mm × 1 or 2 mm × 2+, drains ≥ 1.5 mm).
 */
import type { Manifold } from 'manifold-3d'
import { runtime } from '../runtime/index'
import { trianglesFromManifold } from '../solid/solid'
import { distanceGrid, levelSetOf } from './sdf'

const DRAIN_RADIUS = 1
/** Grid spacing as a fraction of the wall, and its bounds in mm. */
const SPACING_PER_WALL = 0.4
const MIN_SPACING = 0.12
const MAX_CELLS = 220

export interface Hollowed {
  manifold: Manifold
  /** The cavity opens through the flat back (no drain holes needed). */
  open: boolean
  drains: number
}

/**
 * `body` is the finished outer shape; `envelope` the same body before its back was flattened
 * (pass `body` again when there is no flat back). Returns null when the walls would meet
 * everywhere (the body is thinner than two walls). The caller owns the returned Manifold.
 */
export function hollowBody(body: Manifold, envelope: Manifold, wall: number): Hollowed | null {
  const { manifold: mf } = runtime()
  const box = envelope.boundingBox()
  const extent = Math.max(...[0, 1, 2].map((k) => box.max[k]! - box.min[k]!))
  const spacing = Math.max(wall * SPACING_PER_WALL, MIN_SPACING, extent / MAX_CELLS)
  const grid = distanceGrid(trianglesFromManifold(envelope), { spacing, band: wall + 3 * spacing, votes: 1 })
  // Interpolation can pull the iso-surface up to ~¼ cell toward the outside; keep walls ≥ wall.
  const cavity = levelSetOf(grid, wall + spacing / 4)
  const owned: Manifold[] = [cavity]
  try {
    if (cavity.isEmpty() || cavity.volume() < spacing ** 3) return null
    const back = body.boundingBox().max[1]
    const open = cavity.boundingBox().max[1] > back + 1e-6
    let tool = cavity
    let drains = 0
    if (!open) {
      const holes = drainHoles(cavity, back)
      drains = holes.length
      owned.push(...holes)
      if (holes.length > 0) {
        tool = mf.Manifold.union([cavity, ...holes])
        owned.push(tool)
      }
    }
    const result = body.subtract(tool)
    if (result.isEmpty() || result.volume() >= body.volume()) {
      result.delete()
      return null
    }
    return { manifold: result, open, drains }
  } finally {
    for (const m of owned) m.delete()
  }
}

/** Two escape holes along +Y from the highest and lowest back-facing points of the cavity. */
function drainHoles(cavity: Manifold, back: number): Manifold[] {
  const { manifold: mf } = runtime()
  const { positions: p, indices } = trianglesFromManifold(cavity)
  let top: [number, number, number] | null = null
  let bottom: [number, number, number] | null = null
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3
    const b = indices[t + 1]! * 3
    const c = indices[t + 2]! * 3
    const ux = p[b]! - p[a]!
    const uy = p[b + 1]! - p[a + 1]!
    const uz = p[b + 2]! - p[a + 2]!
    const vx = p[c]! - p[a]!
    const vy = p[c + 1]! - p[a + 1]!
    const vz = p[c + 2]! - p[a + 2]!
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    // Faces of the cavity that look toward the back wall.
    if (ny < 0.6 * Math.hypot(nx, ny, nz)) continue
    const centre: [number, number, number] = [
      (p[a]! + p[b]! + p[c]!) / 3,
      (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3,
      (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3,
    ]
    if (!top || centre[2] > top[2]) top = centre
    if (!bottom || centre[2] < bottom[2]) bottom = centre
  }
  if (!top || !bottom) return []
  // Each hole is inset by its radius toward the middle so its rim stays over the cavity.
  const spots: [number, number, number][] =
    top[2] - bottom[2] > 4 * DRAIN_RADIUS
      ? [
          [top[0], top[1], top[2] - DRAIN_RADIUS],
          [bottom[0], bottom[1], bottom[2] + DRAIN_RADIUS],
        ]
      : [[top[0], top[1], (top[2] + bottom[2]) / 2]]
  return spots.map(([x, y, z]) => {
    const start = y - 2 * DRAIN_RADIUS
    const cylinder = mf.Manifold.cylinder(back + 1 - start, DRAIN_RADIUS, DRAIN_RADIUS, 24)
    try {
      // Cylinder axis +Z → +Y, from inside the cavity out through the back.
      return cylinder.rotate([-90, 0, 0]).translate([x, start, z])
    } finally {
      cylinder.delete()
    }
  })
}
