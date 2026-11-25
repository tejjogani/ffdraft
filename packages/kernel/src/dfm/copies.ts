/**
 * Copies that coincide: a node whose bodies include the same body twice in the same place
 * (a polar pattern about an axis through its source, a mirror across a plane the body is
 * symmetric about). The copies add no metal; they are almost always a mistake in the pattern.
 */
import type { Scene } from '../core'
import { distinctSolids } from '../evaluate/assemble'
import type { Diagnostic } from '../types'

export function copyChecks(scene: Scene): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const result of scene.nodes.values()) {
    if (result.status !== 'ok' || !result.node.visible || result.bodies.length < 2) continue
    const solids = result.bodies.map((b) => b.solid)
    const extra = solids.length - distinctSolids(solids, scene.quality).length
    if (extra === 0) continue
    out.push({
      level: 'warning',
      code: 'pattern.coincident',
      nodeId: result.id,
      message: `${extra} of the ${solids.length} copies in “${result.node.name ?? result.id}” sit exactly on top of another copy and add no metal; move the pattern's centre or axis away from what it copies.`,
      value: extra,
    })
  }
  return out
}
