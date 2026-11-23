/**
 * A chain through a bail: the opening must clear the chain by the bail rule, and the chain as
 * built must not run through the bail's metal.
 */
import type { Scene } from '../core'
import type { ChainData } from '../features/chain'
import { runtime } from '../runtime/index'
import type { Diagnostic } from '../types'
import type { DfmProfile } from './profile'

/** Overlap below this is tessellation noise, not a clash (mm³). */
const CLASH_MM3 = 1e-3

export function chainChecks(scene: Scene, profile: DfmProfile): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const result of scene.nodes.values()) {
    const node = result.node
    if (result.status !== 'ok' || node.kind !== 'chain' || !node.through) continue
    const bail = scene.nodes.get(node.through)
    if (bail?.status !== 'ok' || bail.node.kind !== 'bail') continue
    const { width } = result.data as ChainData
    const needed = width + profile.bailClearance
    if (bail.node.opening < needed)
      out.push({
        level: 'error',
        code: 'bail.small',
        nodeId: bail.id,
        message: `The bail opening (${bail.node.opening.toFixed(1)} mm) must clear the ${width.toFixed(1)} mm chain by ${profile.bailClearance} mm: make it ${needed.toFixed(1)} mm.`,
        value: bail.node.opening,
        limit: needed,
        fix: { label: `Open the bail to ${needed.toFixed(1)} mm`, ops: [{ t: 'update', id: bail.id, patch: { opening: Math.ceil(needed * 10) / 10 } }] },
      })
    if (scene.detail !== 'production') continue
    const { manifold: mf } = runtime()
    const chain = result.bodies.map((b) => b.solid.manifold(scene.quality))
    const metal = bail.bodies.map((b) => b.solid.manifold(scene.quality))
    const a = mf.Manifold.union(chain)
    const b = mf.Manifold.union(metal)
    const overlap = a.intersect(b)
    try {
      const volume = overlap.volume()
      if (volume > CLASH_MM3) {
        const box = overlap.boundingBox()
        out.push({
          level: 'error',
          code: 'chain.clash',
          nodeId: node.id,
          message: `The chain runs through the bail's metal (${volume.toFixed(2)} mm³ overlap): use a larger or rounder bail, or a narrower chain.`,
          at: [0, 1, 2].map((k) => (box.min[k]! + box.max[k]!) / 2) as [number, number, number],
          value: volume,
          limit: 0,
        })
      }
    } finally {
      for (const m of [overlap, a, b]) m.delete()
    }
  }
  return out
}
