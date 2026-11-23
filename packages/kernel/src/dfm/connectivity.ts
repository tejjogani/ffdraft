/**
 * Metal that will not come out of the mould as part of its piece: a finding or bail that does
 * not touch the body it is meant to be fused to, and slivers left behind by cuts.
 */
import type { Scene } from '../core'
import type { Bounds, Diagnostic } from '../types'
import type { DfmProfile } from './profile'

const centre = (b: Bounds): [number, number, number] => [
  (b.min[0] + b.max[0]) / 2,
  (b.min[1] + b.max[1]) / 2,
  (b.min[2] + b.max[2]) / 2,
]

/** The node currently carrying `id`'s metal (following booleans and groups that consumed it). */
function carrier(scene: Scene, id: string): string {
  const consumedBy = new Map<string, string>()
  for (const r of scene.nodes.values()) for (const c of r.consumes) consumedBy.set(c, r.id)
  let current = id
  for (let hops = 0; consumedBy.has(current) && hops < 64; hops++) current = consumedBy.get(current)!
  return current
}

export function connectivityChecks(scene: Scene, profile: DfmProfile): Diagnostic[] {
  if (scene.detail !== 'production') return []
  const out: Diagnostic[] = []
  const partsOf = (id: string) => scene.parts.filter((p) => p.sources.some((s) => s.nodeId === id))
  for (const result of scene.nodes.values()) {
    const node = result.node
    if (result.status !== 'ok' || !node.visible || result.bodies.length === 0) continue
    if ((node.kind !== 'finding' && node.kind !== 'bail') || !node.host) continue
    const host = carrier(scene, node.host)
    const own = partsOf(carrier(scene, node.id))
    if (own.length > 0 && !own.some((p) => p.sources.some((s) => s.nodeId === host)))
      out.push({
        level: 'error',
        code: 'metal.disconnected',
        nodeId: node.id,
        message: `“${node.name ?? node.id}” does not touch the piece it belongs to, so it would cast loose. Move it until it overlaps.`,
        at: centre(own[0]!.part.bounds),
      })
  }
  for (const { part } of scene.parts)
    if (part.volumeMm3 < profile.fragment)
      out.push({
        level: 'warning',
        code: 'metal.fragment',
        nodeId: part.nodeId,
        message: `A ${part.volumeMm3.toFixed(3)} mm³ sliver of metal is left loose; it will not cast.`,
        at: centre(part.bounds),
        value: part.volumeMm3,
        limit: profile.fragment,
      })
  return out
}
