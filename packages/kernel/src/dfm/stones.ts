/**
 * Stones that collide: with each other (two seats cannot share a girdle) or with metal that
 * should have been cut away for them (a stone pushed into a body with no seat).
 */
import type { Manifold } from 'manifold-3d'
import type { Scene, SceneStone } from '../core'
import { runtime } from '../runtime/index'
import { boundsOverlap, weld } from '../solid/meshing'
import { manifoldFromTriangles } from '../solid/solid'
import type { Bounds, Diagnostic } from '../types'
import type { DfmProfile } from './profile'

/** Overlap below this is tessellation noise between touching facets (mm³). */
const NOISE_MM3 = 1e-4

/** Each stone as a Manifold (its unit gem mesh placed by its matrix). The caller deletes them. */
function stoneManifolds(scene: Scene): Manifold[] {
  const units = new Map<string, Manifold>()
  try {
    return scene.stones.map(({ instance }) => {
      let unit = units.get(instance.meshKey)
      if (!unit) {
        const mesh = scene.evaluation.gemMeshes[instance.meshKey]!
        unit = manifoldFromTriangles(weld(mesh.positions, mesh.indices))
        units.set(instance.meshKey, unit)
      }
      return unit.transform(instance.matrix as Parameters<Manifold['transform']>[0])
    })
  } finally {
    for (const u of units.values()) u.delete()
  }
}

const radiusOf = ({ stone }: SceneStone) =>
  Math.hypot(stone.dims.length, stone.dims.width, stone.dims.depth) / 2

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
 * All stones are cut against the metal in one boolean; the pieces are given back to the stone
 * whose centre is nearest.
 */
function buried(scene: Scene, gems: readonly Manifold[], profile: DfmProfile): Diagnostic[] {
  // Only parts that reach a stone (a necklace's hundreds of links mostly do not).
  const near = (b: Bounds) =>
    scene.stones.some((s) => {
      const r = radiusOf(s)
      const o = s.stone.frame.origin
      return boundsOverlap(b, { min: [o[0] - r, o[1] - r, o[2] - r], max: [o[0] + r, o[1] + r, o[2] + r] })
    })
  const metal = scene.parts.flatMap((p) => (p.fused && near(p.part.bounds) ? [p.fused.manifold(scene.quality)] : []))
  if (metal.length === 0) return []
  const { manifold: mf } = runtime()
  const all = mf.Manifold.union(metal)
  const stones = mf.Manifold.compose([...gems])
  const shared = stones.intersect(all)
  const pieces = shared.decompose()
  try {
    const volumes = new Float64Array(gems.length)
    for (const piece of pieces) {
      const box = piece.boundingBox()
      const c = [0, 1, 2].map((k) => (box.min[k]! + box.max[k]!) / 2)
      let best = 0
      let bestD = Infinity
      scene.stones.forEach((s, i) => {
        const o = s.stone.frame.origin
        const d = (o[0] - c[0]!) ** 2 + (o[1] - c[1]!) ** 2 + (o[2] - c[2]!) ** 2
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      volumes[best]! += piece.volume()
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
  } finally {
    for (const m of [all, stones, shared, ...pieces]) m.delete()
  }
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
