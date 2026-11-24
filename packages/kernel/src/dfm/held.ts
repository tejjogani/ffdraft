/**
 * Stones that nothing holds. Every stone must have metal — a claw, a bezel, a seat, a bead —
 * at its girdle; any node's transform can move a setting, a row or a pavé field away from its
 * stones (or a gem up off its band), and nothing else would notice: the stone simply sits in the
 * air next to an empty setting. Runs at both details: a warning while designing, an error on
 * the production evaluation a caster works from.
 */
import type { Scene, SceneStone } from '../core'
import { gemUnit } from '../gems/index'
import { outlinePoint } from '../gems/outline'
import { fromFrame, type Vec3 } from '../geometry/vec'
import { type ClosestHit, TriangleBvh } from '../mesh/bvh'
import { boundsOverlap } from '../solid/meshing'
import type { Bounds, Diagnostic } from '../types'

/** Metal must come this close to the girdle, as a share of the stone's width, plus a margin. */
const REACH_SHARE = 0.2
const REACH_MM = 0.15
/** Girdle sample points; held points must not all fit in a half circle of them. */
const AROUND = 12
const MAX_REPORTED = 12

/** Girdle points in world space. */
function girdle(stone: SceneStone): Vec3[] {
  const { dims, frame, cut } = stone.stone
  const unit = gemUnit(cut, dims.length / dims.width)
  const sy = dims.length / unit.length
  const points: Vec3[] = []
  for (let i = 0; i < AROUND; i++) {
    const [x, y] = outlinePoint(unit.outline, (i / AROUND) * 2 * Math.PI)
    points.push(fromFrame(frame, [x * dims.width, y * sy, 0]))
  }
  return points
}

/**
 * Metal holds a stone when it reaches the girdle from all round — claws, a bezel, a seat, two
 * bars facing each other — not when it only grazes one side (an empty bezel moved next to it):
 * the girdle points with metal at them must not all fit in one half of the girdle.
 */
function surrounds(gripped: readonly boolean[]): boolean {
  const at = gripped.flatMap((g, i) => (g ? [i] : []))
  if (at.length < 2) return false
  let widest = 0
  for (let k = 0; k < at.length; k++) {
    const next = k + 1 < at.length ? at[k + 1]! : at[0]! + AROUND
    widest = Math.max(widest, next - at[k]!)
  }
  return widest <= AROUND / 2
}

export function heldChecks(scene: Scene): Diagnostic[] {
  if (scene.stones.length === 0) return []
  const parts = scene.parts.map((p) => ({
    bounds: p.part.bounds,
    mesh: p.part.mesh,
    bvh: null as TriangleBvh | null,
  }))
  const hit: ClosestHit = { d2: 0, x: 0, y: 0, z: 0, triangle: 0 }
  const loose = new Map<string, { count: number; first: SceneStone; gap: number }>()
  for (const stone of scene.stones) {
    const reach = REACH_SHARE * stone.stone.dims.width + REACH_MM
    const points = girdle(stone)
    const box: Bounds = {
      min: [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k]!)) - reach) as Bounds['min'],
      max: [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k]!)) + reach) as Bounds['max'],
    }
    const near = parts.filter((part) => boundsOverlap(part.bounds, box))
    const gripped = points.map((p) =>
      near.some((part) => {
        part.bvh ??= new TriangleBvh(part.mesh)
        return part.bvh.closest(p[0], p[1], p[2], hit, reach)
      }),
    )
    if (surrounds(gripped)) continue
    const entry = loose.get(stone.instance.nodeId)
    if (entry) entry.count++
    else loose.set(stone.instance.nodeId, { count: 1, first: stone, gap: reach })
  }
  const production = scene.detail === 'production'
  return [...loose].slice(0, MAX_REPORTED).map(([nodeId, { count, first, gap }]) => ({
    level: production ? ('error' as const) : ('warning' as const),
    code: 'stone.unheld',
    nodeId,
    message: `${count === 1 ? `Stone ${first.instance.id} has` : `${count} stones (first: ${first.instance.id}) have`} no metal within ${gap.toFixed(2)} mm of the girdle, so nothing holds ${count === 1 ? 'it' : 'them'}. Add a setting, or move the setting or the stones back together.`,
    at: [...first.stone.frame.origin] as [number, number, number],
    value: count,
  }))
}
