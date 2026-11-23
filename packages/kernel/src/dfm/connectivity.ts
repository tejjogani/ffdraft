/**
 * Metal that will not come out of the mould as part of its piece: a finding or bail that does
 * not touch the body it is meant to be fused to, and slivers left behind by cuts.
 */
import type { Body, Scene } from '../core'
import { runtime } from '../runtime/index'
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
  for (let hops = 0; consumedBy.has(current) && hops < 64; hops++)
    current = consumedBy.get(current)!
  return current
}

/** Overlap below this is touching, not fused (mm³). */
const FUSED_MM3 = 1e-4

/** Whether two sets of bodies share metal (so they fuse into one casting). */
function fused(a: readonly Body[], b: readonly Body[], scene: Scene): boolean {
  const { manifold: mf } = runtime()
  const left = mf.Manifold.union(a.map((x) => x.solid.manifold(scene.quality)))
  const right = mf.Manifold.union(b.map((x) => x.solid.manifold(scene.quality)))
  const shared = left.intersect(right)
  try {
    return shared.volume() > FUSED_MM3
  } finally {
    for (const m of [left, right, shared]) m.delete()
  }
}

export function connectivityChecks(scene: Scene, profile: DfmProfile): Diagnostic[] {
  if (scene.detail !== 'production') return []
  const out: Diagnostic[] = []
  for (const result of scene.nodes.values()) {
    const node = result.node
    if (result.status !== 'ok' || !node.visible || result.bodies.length === 0) continue
    if ((node.kind !== 'finding' && node.kind !== 'bail') || !node.host) continue
    const host = scene.nodes.get(carrier(scene, node.host))
    if (!host || host.bodies.length === 0 || fused(result.bodies, host.bodies, scene)) continue
    out.push({
      level: 'error',
      code: 'metal.disconnected',
      nodeId: node.id,
      message: `“${node.name ?? node.id}” does not touch the piece it belongs to, so it would cast loose. Move it until it overlaps.`,
      at: centre(result.bodies[0]!.solid.bounds()),
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
