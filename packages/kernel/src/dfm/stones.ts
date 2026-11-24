/**
 * Stones that collide: with each other (two seats cannot share a girdle) or with metal that
 * should have been cut away for them (a stone pushed into a body with no seat).
 */
import type { Manifold } from 'manifold-3d'
import type { Scene, SceneStone } from '../core'
import { girdlesOverlap } from '../evaluate/diagnostics'
import { runtime } from '../runtime/index'
import { boundsOverlap, weld } from '../solid/meshing'
import { manifoldFromTriangles } from '../solid/solid'
import type { Bounds, Diagnostic, MeshData } from '../types'
import type { DfmProfile } from './profile'

/** Overlap below this is tessellation noise between touching facets (mm³). */
const NOISE_MM3 = 1e-4
/** Stones intersected with a part per boolean in the buried-stone check. */
const BURIED_BATCH = 64

/**
 * A unit gem as a closed solid. Cuts that come to a point (marquise, pear, trillion) can weld
 * into a mesh Manifold rejects; their convex hull is the same stone (every cut but the heart is
 * convex, and a hull only errs toward reporting a collision) and is always closed.
 */
function unitGem(mesh: MeshData): Manifold {
  const welded = weld(mesh.positions, mesh.indices)
  try {
    return manifoldFromTriangles(welded)
  } catch {
    const p = welded.positions
    const points: [number, number, number][] = []
    for (let i = 0; i < p.length; i += 3) points.push([p[i]!, p[i + 1]!, p[i + 2]!])
    return runtime().manifold.Manifold.hull(points)
  }
}

/** Each stone as a Manifold (its unit gem mesh placed by its matrix). The caller deletes them. */
function stoneManifolds(scene: Scene): Manifold[] {
  const units = new Map<string, Manifold>()
  const placed: Manifold[] = []
  try {
    for (const { instance } of scene.stones) {
      let unit = units.get(instance.meshKey)
      if (!unit) {
        unit = unitGem(scene.evaluation.gemMeshes[instance.meshKey]!)
        units.set(instance.meshKey, unit)
      }
      placed.push(unit.transform(instance.matrix as Parameters<Manifold['transform']>[0]))
    }
    return placed
  } catch (error) {
    for (const m of placed) m.delete()
    throw error
  } finally {
    for (const u of units.values()) u.delete()
  }
}

const radiusOf = ({ stone }: SceneStone) =>
  Math.hypot(stone.dims.length, stone.dims.width, stone.dims.depth) / 2

const boundsOf = (s: SceneStone): Bounds => {
  const r = radiusOf(s)
  const o = s.stone.frame.origin
  return { min: [o[0] - r, o[1] - r, o[2] - r], max: [o[0] + r, o[1] + r, o[2] + r] }
}

/**
 * Stones whose bodies overlap where the girdle test (`stone.overlap`, run on every evaluation)
 * cannot see it: pavilions or crowns of tilted stones crossing below or above the girdles.
 *
 * Each stone is first intersected with all its later neighbours at once (one boolean per stone
 * instead of one per pair — a dense pavé has a dozen neighbours per stone, and pairwise booleans
 * took a minute on 1 900 stones); only a stone that overlaps something is then tested pair by
 * pair to name the other stone.
 */
function collisions(scene: Scene, gems: readonly Manifold[]): Diagnostic[] {
  const { manifold: mf } = runtime()
  const out: Diagnostic[] = []
  const { stones } = scene
  const radii = stones.map(radiusOf)
  // Hash grid on the largest reach, so neighbour lookups stay local with thousands of stones.
  const cell = Math.max(1e-3, 2 * radii.reduce((r, x) => Math.max(r, x), 0))
  const keyOf = (p: readonly number[], dx = 0, dy = 0, dz = 0) =>
    `${Math.floor(p[0]! / cell) + dx},${Math.floor(p[1]! / cell) + dy},${Math.floor(p[2]! / cell) + dz}`
  const grid = new Map<string, number[]>()
  stones.forEach((s, i) => {
    const k = keyOf(s.stone.frame.origin)
    const list = grid.get(k)
    if (list) list.push(i)
    else grid.set(k, [i])
  })
  const overlapVolume = (a: Manifold, b: Manifold) => {
    const overlap = a.intersect(b)
    try {
      return overlap.volume()
    } finally {
      overlap.delete()
    }
  }
  for (let i = 0; i < stones.length; i++) {
    const a = stones[i]!.stone.frame.origin
    const near: number[] = []
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const j of grid.get(keyOf(a, dx, dy, dz)) ?? []) {
            if (j <= i) continue
            const b = stones[j]!.stone.frame.origin
            if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > radii[i]! + radii[j]!) continue
            if (girdlesOverlap(stones[i]!, stones[j]!)) continue
            near.push(j)
          }
    if (near.length === 0) continue
    if (near.length > 1) {
      const together = mf.Manifold.compose(near.map((j) => gems[j]!))
      try {
        if (overlapVolume(gems[i]!, together) <= NOISE_MM3) continue
      } finally {
        together.delete()
      }
    }
    for (const j of near) {
      const volume = overlapVolume(gems[i]!, gems[j]!)
      if (volume <= NOISE_MM3) continue
      const b = stones[j]!.stone.frame.origin
      out.push({
        level: 'error',
        code: 'stone.collision',
        nodeId: stones[i]!.instance.nodeId,
        message: `Stones ${stones[i]!.instance.id} and ${stones[j]!.instance.id} overlap below or above their girdles; they cannot both be set.`,
        at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
        value: volume,
      })
    }
  }
  return out
}

/**
 * Stones whose volume is buried in production metal beyond what claws and bezel lips cover.
 * Each part is tested once against all the stones within its bounds (one boolean per part, as
 * production assembly batches its cutters); the pieces are given back to the stone whose centre
 * is nearest. A chain's own stones are left to the chain: its links are built around them.
 */
function buried(scene: Scene, gems: readonly Manifold[], profile: DfmProfile): Diagnostic[] {
  const { manifold: mf } = runtime()
  const chains = new Set(
    [...scene.nodes.values()].filter((r) => r.node.kind === 'chain').map((r) => r.id),
  )
  const boxes = scene.stones.map(boundsOf)
  const volumes = new Float64Array(gems.length)
  for (const { part, fused, sources } of scene.parts) {
    if (!fused) continue
    const own = new Set(sources.map((s) => s.nodeId).filter((id) => chains.has(id)))
    const near = scene.stones.flatMap((s, i) =>
      !own.has(s.instance.nodeId) && boundsOverlap(boxes[i]!, part.bounds) ? [i] : [],
    )
    if (near.length === 0) continue
    // Stones go through in small, spatially sorted batches: one boolean of the whole pavé
    // against the part held gigabytes of intermediate mesh on a 100 mm iced piece.
    near.sort((i, j) => {
      const a = scene.stones[i]!.stone.frame.origin
      const b = scene.stones[j]!.stone.frame.origin
      return a[2] - b[2] || a[0] - b[0] || a[1] - b[1]
    })
    for (let start = 0; start < near.length; start += BURIED_BATCH) {
      const chunk = near.slice(start, start + BURIED_BATCH)
      const stones = mf.Manifold.compose(chunk.map((i) => gems[i]!))
      const shared = stones.intersect(fused.manifold(scene.quality))
      const pieces = shared.decompose()
      try {
        for (const piece of pieces) {
          const box = piece.boundingBox()
          const c = [0, 1, 2].map((k) => (box.min[k]! + box.max[k]!) / 2)
          let best = chunk[0]!
          let bestD = Infinity
          for (const i of chunk) {
            const o = scene.stones[i]!.stone.frame.origin
            const d = (o[0] - c[0]!) ** 2 + (o[1] - c[1]!) ** 2 + (o[2] - c[2]!) ** 2
            if (d < bestD) {
              bestD = d
              best = i
            }
          }
          volumes[best]! += piece.volume()
        }
      } finally {
        for (const m of [stones, shared, ...pieces]) m.delete()
      }
    }
  }
  // One diagnostic per node, at its worst stone: a pavé of thousands left unseated must read as
  // one finding, not thousands.
  const worst = new Map<string, { stone: SceneStone; fraction: number; count: number }>()
  scene.stones.forEach((stone, i) => {
    const fraction = volumes[i]! / gems[i]!.volume()
    if (fraction <= profile.stoneInMetal) return
    const entry = worst.get(stone.instance.nodeId)
    if (!entry) worst.set(stone.instance.nodeId, { stone, fraction, count: 1 })
    else {
      entry.count++
      if (fraction > entry.fraction) Object.assign(entry, { stone, fraction })
    }
  })
  return [...worst].map(([nodeId, { stone, fraction, count }]) => ({
    // Half a stone in metal is not a setting a setter can fix with a bur: it is buried.
    level: fraction > 0.5 ? ('error' as const) : ('warning' as const),
    code: 'stone.inMetal',
    nodeId,
    message: `${Math.round(fraction * 100)} % of stone ${stone.instance.id} is inside metal${count > 1 ? ` (${count} stones of this feature are partly buried)` : ''}: it needs a seat (or a setting) before it can be set.`,
    at: [...stone.stone.frame.origin] as [number, number, number],
    value: fraction,
    limit: profile.stoneInMetal,
  }))
}

export function stoneChecks(scene: Scene, profile: DfmProfile): Diagnostic[] {
  // Exact booleans on every stone: production only (draft has the girdle test, stone.overlap).
  if (scene.stones.length === 0 || scene.detail !== 'production') return []
  const gems = stoneManifolds(scene)
  try {
    return [...collisions(scene, gems), ...buried(scene, gems, profile)]
  } finally {
    for (const g of gems) g.delete()
  }
}
