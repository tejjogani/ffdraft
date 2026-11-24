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
import type { Bounds, Diagnostic, MeshData } from '../types'
import { explainedBy, stoneName } from './subjects'

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

/**
 * Search trees by display mesh. A part that did not change keeps its mesh object from one
 * evaluation to the next, so a slider drag elsewhere does not rebuild the tree of a 180k
 * triangle chain (100 ms on every draft edit). Entries go with their meshes.
 */
const trees = new WeakMap<MeshData, TriangleBvh>()
const treeOf = (mesh: MeshData): TriangleBvh => {
  let tree = trees.get(mesh)
  if (!tree) {
    tree = new TriangleBvh(mesh)
    trees.set(mesh, tree)
  }
  return tree
}

/**
 * Whether a point lies inside a part's closed, outward-wound surface: the nearest surface point
 * faces away from it. Good away from sharp edges, which is where a buried girdle centre is.
 */
function inside(mesh: MeshData, p: Vec3, hit: ClosestHit): boolean {
  if (!treeOf(mesh).closest(p[0], p[1], p[2], hit)) return false
  const { positions: v, indices } = mesh
  const [a, b, c] = [0, 1, 2].map((k) => indices[hit.triangle * 3 + k]! * 3) as [
    number,
    number,
    number,
  ]
  const u = [v[b]! - v[a]!, v[b + 1]! - v[a + 1]!, v[b + 2]! - v[a + 2]!]
  const w = [v[c]! - v[a]!, v[c + 1]! - v[a + 1]!, v[c + 2]! - v[a + 2]!]
  const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!]
  return n[0]! * (p[0] - hit.x) + n[1]! * (p[1] - hit.y) + n[2]! * (p[2] - hit.z) < 0
}

export function heldChecks(scene: Scene): Diagnostic[] {
  if (scene.stones.length === 0) return []
  // A flush setting with nothing to sink into already says nothing holds its stone.
  const explained = explainedBy(scene, 'setting.noHost')
  const parts = scene.parts.map((p) => ({
    bounds: p.part.bounds,
    mesh: p.part.mesh,
    // A chain holds only its own stones; a pendant's stones never rely on the chain beside it.
    chain: scene.nodes.get(p.part.nodeId)?.node.kind === 'chain' ? p.part.nodeId : null,
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
    const near = parts.filter(
      (part) =>
        (part.chain === null || part.chain === stone.instance.nodeId) &&
        boundsOverlap(part.bounds, box),
    )
    const gripped = points.map((p) =>
      near.some((part) => treeOf(part.mesh).closest(p[0], p[1], p[2], hit, reach)),
    )
    if (surrounds(gripped) || explained.has(stone.instance.nodeId)) continue
    // A stone buried in metal is held, all too well: that is stone.inMetal's finding, and
    // "no metal near the girdle" would be untrue.
    const centre = stone.stone.frame.origin
    if (near.some((part) => inside(part.mesh, centre, hit))) continue
    const entry = loose.get(stone.instance.nodeId)
    if (entry) entry.count++
    else loose.set(stone.instance.nodeId, { count: 1, first: stone, gap: reach })
  }
  const production = scene.detail === 'production'
  return [...loose].slice(0, MAX_REPORTED).map(([nodeId, { count, first, gap }]) => ({
    level: production ? ('error' as const) : ('warning' as const),
    code: 'stone.unheld',
    nodeId,
    message: `${count === 1 ? `${stoneName(scene, first.instance)} has` : `${count} stones (first: ${stoneName(scene, first.instance)}) have`} no metal within ${gap.toFixed(2)} mm of the girdle, so nothing holds ${count === 1 ? 'it' : 'them'}. Add a setting, or move the setting or the stones back together.`,
    at: [...first.stone.frame.origin] as [number, number, number],
    related: [first.instance.id],
    value: count,
  }))
}
