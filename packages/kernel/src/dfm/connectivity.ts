/**
 * Metal that will not come out of the mould as part of its piece. Every node that builds on
 * another node's metal — a setting on its gem's shank, a halo, a gem row, a bail or post on its
 * host — must end up in the same production shell as that metal. A shell that holds such a node
 * but none of the metal it builds on would cast loose. Parts that are separate by nature are
 * exempt: chains, butterfly backs and lobster clasps, and the copies a pattern makes.
 *
 * Also reports slivers left behind by cuts.
 */
import { METALS, type Node, nodeRefs } from '@pave/schema'
import type { NodeResult, Scene } from '../core'
import { boundsOverlap } from '../solid/meshing'
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

/** Castings closer than this are touching: two alloys share a face, not a gap (mm). */
const TOUCH = 0.01

/** True when two production parts touch or overlap. */
function touching(scene: Scene, a: number, b: number): boolean {
  const pa = scene.parts[a]!
  const pb = scene.parts[b]!
  if (!pa.fused || !pb.fused || !boundsOverlap(pa.part.bounds, pb.part.bounds, TOUCH)) return false
  return (
    pa.fused.manifold(scene.quality).minGap(pb.fused.manifold(scene.quality), 2 * TOUCH) < TOUCH
  )
}

/**
 * Shells that touch nothing of the piece and build on nothing: a ball placed beside a ring,
 * referencing no node, passes every rule above, yet comes out of the mould as a second casting.
 * Everything reachable from the largest casting through touching shells is the piece.
 */
function strayCastings(
  scene: Scene,
  reported: readonly Diagnostic[],
  profile: DfmProfile,
): Diagnostic[] {
  const flagged = new Set(reported.map((d) => d.nodeId))
  const exempt = (i: number) =>
    scene.parts[i]!.sources.some((s) => {
      const node = scene.nodes.get(s.nodeId)?.node
      return !node || separate(node) || flagged.has(s.nodeId)
    })
  const candidates = [...scene.parts.keys()].filter(
    (i) => !exempt(i) && scene.parts[i]!.part.volumeMm3 >= profile.fragment,
  )
  if (candidates.length < 2) return []
  const main = candidates.reduce((a, b) =>
    scene.parts[b]!.part.volumeMm3 > scene.parts[a]!.part.volumeMm3 ? b : a,
  )
  // Shells of one node belong together (a head cast as two claw pairs), whatever they touch.
  const nodesOf = (i: number) => new Set(scene.parts[i]!.sources.map((s) => s.nodeId))
  const reached = new Set([main])
  for (let grew = true; grew; ) {
    grew = false
    for (const i of candidates) {
      if (reached.has(i)) continue
      const mine = nodesOf(i)
      if (
        [...reached].some((r) => [...nodesOf(r)].some((n) => mine.has(n)) || touching(scene, i, r))
      ) {
        reached.add(i)
        grew = true
      }
    }
  }
  return candidates
    .filter((i) => !reached.has(i))
    .map((i) => {
      const { part } = scene.parts[i]!
      const name = scene.nodes.get(part.nodeId)?.node.name ?? part.nodeId
      return {
        level: 'warning' as const,
        code: 'metal.separate',
        nodeId: part.nodeId,
        message: `“${name}” touches nothing else in the piece, so it would cast as a separate part. Move it until it overlaps, or remove it.`,
        at: centre(part.bounds),
      }
    })
}

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
    const baseParts = [...new Set(bases.flatMap((b) => [...partsOf.get(b)!]))]
    let loose = [...own].filter((i) => !baseParts.includes(i))
    if (loose.length === 0) continue
    const names = bases.map((b) => `“${scene.nodes.get(b)!.node.name ?? b}”`).join(' or ')
    // A shell of another alloy is its own casting by necessity: it is loose only if it does not
    // even touch the metal it builds on (it is assembled onto it after casting).
    const otherAlloy = loose.filter((i) =>
      baseParts.every((b) => scene.parts[b]!.part.material !== scene.parts[i]!.part.material),
    )
    const seated = otherAlloy.filter((i) => baseParts.some((b) => touching(scene, i, b)))
    if (seated.length > 0) {
      const metal = METALS[scene.parts[seated[0]!]!.part.material].label
      out.push({
        level: 'info',
        code: 'metal.separateCasting',
        nodeId: result.id,
        message: `“${node.name ?? result.id}” is cast separately in ${metal} (${seated.length === 1 ? 'one piece' : `${seated.length} pieces`}) and assembled onto ${names}.`,
        at: centre(scene.parts[seated[0]!]!.part.bounds),
      })
      loose = loose.filter((i) => !seated.includes(i))
      if (loose.length === 0) continue
    }
    // A bail that places itself and found nothing to stand on has already said so, with the
    // right advice; "move it" would point at a node that has no position of its own.
    if (result.diagnostics.some((d) => d.code === 'bail.unsupported')) continue
    out.push({
      level: 'error',
      code: 'metal.disconnected',
      nodeId: result.id,
      message: `“${node.name ?? result.id}” does not touch ${names}, so it would cast loose. Move it until it overlaps.`,
      at: centre(scene.parts[loose[0]!]!.part.bounds),
    })
  }
  out.push(...strayCastings(scene, out, profile))
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
