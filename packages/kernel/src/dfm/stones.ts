/**
 * Stones that collide: with each other (two seats cannot share a girdle) or with metal that
 * should have been cut away for them (a stone pushed into a body with no seat).
 */
import type { Manifold } from 'manifold-3d'
import type { Scene, SceneStone } from '../core'
import { runtime } from '../runtime/index'
import { boundsOverlap, weld } from '../solid/meshing'
import { manifoldFromTriangles } from '../solid/solid'
import type { Bounds, Diagnostic, MeshData } from '../types'
import type { DfmProfile } from './profile'

/** Overlap below this is tessellation noise between touching facets (mm³). */
const NOISE_MM3 = 1e-4

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

function collisions(scene: Scene, gems: readonly Manifold[]): Diagnostic[] {
  const out: Diagnostic[] = []
  const { stones } = scene
  for (let i = 0; i < stones.length; i++)
    for (let j = i + 1; j < stones.length; j++) {
      const a = stones[i]!.stone.frame.origin
      const b = stones[j]!.stone.frame.origin
      if (
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >
        radiusOf(stones[i]!) + radiusOf(stones[j]!)
      )
        continue
      const overlap = gems[i]!.intersect(gems[j]!)
      try {
        const volume = overlap.volume()
        if (volume > NOISE_MM3)
          out.push({
            level: 'error',
            code: 'stone.collision',
            nodeId: stones[i]!.instance.nodeId,
            message: `Stones ${stones[i]!.instance.id} and ${stones[j]!.instance.id} overlap; they cannot both be set.`,
            at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
            value: volume,
          })
      } finally {
        overlap.delete()
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
    const stones = mf.Manifold.compose(near.map((i) => gems[i]!))
    const shared = stones.intersect(fused.manifold(scene.quality))
    const pieces = shared.decompose()
    try {
      for (const piece of pieces) {
        const box = piece.boundingBox()
        const c = [0, 1, 2].map((k) => (box.min[k]! + box.max[k]!) / 2)
        let best = near[0]!
        let bestD = Infinity
        for (const i of near) {
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
  return scene.stones.flatMap((stone, i) => {
    const fraction = volumes[i]! / gems[i]!.volume()
    return fraction > profile.stoneInMetal
      ? [
          {
            level: 'warning' as const,
            code: 'stone.inMetal',
            nodeId: stone.instance.nodeId,
            message: `${Math.round(fraction * 100)} % of stone ${stone.instance.id} is inside metal: it needs a seat (or a setting) before it can be set.`,
            at: [...stone.stone.frame.origin] as [number, number, number],
            value: fraction,
            limit: profile.stoneInMetal,
          },
        ]
      : []
  })
}

export function stoneChecks(scene: Scene, profile: DfmProfile): Diagnostic[] {
  if (scene.stones.length === 0) return []
  const gems = stoneManifolds(scene)
  try {
    return [
      ...collisions(scene, gems),
      ...(scene.detail === 'production' ? buried(scene, gems, profile) : []),
    ]
  } finally {
    for (const g of gems) g.delete()
  }
}
