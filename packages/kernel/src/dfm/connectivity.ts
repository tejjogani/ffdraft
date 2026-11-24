/**
 * Metal that will not come out of the mould as part of its piece. Every node that builds on
 * another node's metal — a setting on its gem's shank, a halo, a gem row, a bail or post on its
 * host — must end up in the same production shell as that metal. A shell that holds such a node
 * but none of the metal it builds on would cast loose. Parts that are separate by nature are
 * exempt: chains, butterfly backs and lobster clasps, and the copies a pattern makes.
 *
 * Also reports slivers left behind by cuts.
 */
import { type Node, nodeRefs } from '@pave/schema'
import type { NodeResult, Scene } from '../core'
import type { Bounds, Diagnostic } from '../types'
import type { DfmProfile } from './profile'

const centre = (b: Bounds): [number, number, number] => [
  (b.min[0] + b.max[0]) / 2,
  (b.min[1] + b.max[1]) / 2,
  (b.min[2] + b.max[2]) / 2,
]

/** Nodes whose metal is a separate part by design, not something to fuse to its references. */
const separate = (node: Node): boolean =>
  node.kind === 'chain' ||
  node.kind === 'pattern' ||
  node.kind === 'group' ||
  (node.kind === 'finding' && (node.type === 'butterfly' || node.type === 'lobsterClasp'))

export function connectivityChecks(scene: Scene, profile: DfmProfile): Diagnostic[] {
  if (scene.detail !== 'production') return []
  const consumedBy = new Map<string, string>()
  for (const r of scene.nodes.values()) for (const c of r.consumes) consumedBy.set(c, r.id)
  /** The node currently carrying `id`'s metal (following booleans and groups that consumed it). */
  const carrier = (id: string): NodeResult | undefined => {
    let current = id
    for (let hops = 0; consumedBy.has(current) && hops < 64; hops++)
      current = consumedBy.get(current)!
    return scene.nodes.get(current)
  }
  /** Which production parts hold metal from each node. */
  const partsOf = new Map<string, Set<number>>()
  scene.parts.forEach(({ sources }, i) => {
    for (const { nodeId } of sources) partsOf.set(nodeId, (partsOf.get(nodeId) ?? new Set()).add(i))
  })
  /** The metal-carrying nodes a node builds on: its references, looking through stone-only nodes. */
  const foundations = (node: Node, self: string, seen = new Set<string>()): string[] =>
    nodeRefs(node).flatMap((ref) => {
      const carried = carrier(ref)
      if (!carried || carried.status !== 'ok' || carried.id === self || seen.has(carried.id))
        return []
      seen.add(carried.id)
      return partsOf.has(carried.id) ? [carried.id] : foundations(carried.node, self, seen)
    })

  const out: Diagnostic[] = []
  for (const result of scene.nodes.values()) {
    const node = result.node
    const own = partsOf.get(result.id)
    if (!own || separate(node)) continue
    const bases = foundations(node, result.id)
    if (bases.length === 0) continue
    const loose = [...own].filter((i) => !bases.some((b) => partsOf.get(b)!.has(i)))
    if (loose.length === 0) continue
    const names = bases.map((b) => `“${scene.nodes.get(b)!.node.name ?? b}”`).join(' or ')
    out.push({
      level: 'error',
      code: 'metal.disconnected',
      nodeId: result.id,
      message: `“${node.name ?? result.id}” does not touch ${names}, so it would cast loose. Move it until it overlaps.`,
      at: centre(scene.parts[loose[0]!]!.part.bounds),
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
