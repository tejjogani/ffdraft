/** Piece-level checks that need more than one node. Per-feature checks live with the feature. */
import type { SceneStone } from '../core'
import { type GemUnit, gemUnit, unitContains } from '../gems/index'
import { outlinePoint } from '../gems/outline'
import { type Vec3, distance, fromFrame, toFrame } from '../geometry/vec'
import type { Diagnostic } from '../types'

/** Stones may touch girdle to girdle; they collide when one enters the other by more than this (mm). */
const TOLERANCE = 0.02
const MAX_REPORTED = 12

interface Probe {
  stone: SceneStone
  unit: GemUnit
  /** Radius of a sphere around the girdle centre that contains the stone. */
  reach: number
  /** Girdle points, slightly inset, in world space. */
  girdle: Vec3[]
}

function probe(stone: SceneStone): Probe {
  const { dims, frame, cut } = stone.stone
  const unit = gemUnit(cut, dims.length / dims.width)
  const sy = dims.length / unit.length
  const inset = 1 - (2 * TOLERANCE) / dims.width
  const girdle: Vec3[] = []
  for (let i = 0; i < 16; i++) {
    const [x, y] = outlinePoint(unit.outline, (i / 16) * 2 * Math.PI)
    const [cx, cy] = unit.outline.centre
    girdle.push(fromFrame(frame, [(cx + (x - cx) * inset) * dims.width, (cy + (y - cy) * inset) * sy, 0]))
  }
  return { stone, unit, reach: Math.hypot(dims.length / 2, dims.depth), girdle }
}

/** True when any girdle point of `a` lies inside the body of `b`. */
function enters(a: Probe, b: Probe): boolean {
  const { dims, frame } = b.stone.stone
  const sy = dims.length / b.unit.length
  const sz = dims.depth / b.unit.depth
  return a.girdle.some((p) => {
    const local = toFrame(frame, p)
    return unitContains(b.unit, [local[0] / dims.width, local[1] / sy, local[2] / sz])
  })
}

/** Stones that occupy the same space, found with a hash grid so thousands of melee stay cheap. */
export function stoneDiagnostics(stones: readonly SceneStone[]): Diagnostic[] {
  if (stones.length < 2) return []
  const probes = stones.map(probe)
  const cell = 2 * Math.max(...probes.map((p) => p.reach))
  const grid = new Map<string, number[]>()
  const key = (p: Vec3, dx = 0, dy = 0, dz = 0) =>
    `${Math.floor(p[0] / cell) + dx},${Math.floor(p[1] / cell) + dy},${Math.floor(p[2] / cell) + dz}`
  probes.forEach((p, i) => {
    const k = key(p.stone.stone.frame.origin)
    grid.set(k, [...(grid.get(k) ?? []), i])
  })
  const out: Diagnostic[] = []
  let collisions = 0
  probes.forEach((a, i) => {
    const origin = a.stone.stone.frame.origin
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const j of grid.get(key(origin, dx, dy, dz)) ?? []) {
            if (j <= i) continue
            const b = probes[j]!
            if (distance(origin, b.stone.stone.frame.origin) > a.reach + b.reach) continue
            if (!enters(a, b) && !enters(b, a)) continue
            if (collisions++ < MAX_REPORTED)
              out.push({
                level: 'error',
                code: 'stone.overlap',
                nodeId: a.stone.instance.nodeId,
                message:
                  a.stone.instance.nodeId === b.stone.instance.nodeId
                    ? 'Two stones of this feature occupy the same space; widen the gap or use smaller stones.'
                    : 'This stone collides with a stone of another feature.',
                at: [...origin],
              })
          }
  })
  if (collisions > MAX_REPORTED)
    out.push({ level: 'error', code: 'stone.overlap', message: `${collisions - MAX_REPORTED} more pairs of stones overlap.` })
  return out
}
