/**
 * References into a moved group. A group carries its children, so moving it moves them; but a
 * node outside the group that references a child (a finding hosted on it, a setting holding its
 * gem) still sees the child where it was built and is left behind.
 */
import { nodeRefs } from '@pave/schema'
import type { Scene } from '../core'
import { isIdentity } from '../geometry/vec'
import type { Diagnostic } from '../types'

export function groupChecks(scene: Scene): Diagnostic[] {
  const out: Diagnostic[] = []
  const contents = (id: string, into: Set<string>): Set<string> => {
    const node = scene.nodes.get(id)?.node
    if (node?.kind === 'group')
      for (const child of node.children) if (!into.has(child)) contents(child, into.add(child))
    return into
  }
  for (const group of scene.nodes.values()) {
    if (group.node.kind !== 'group' || isIdentity(group.matrix)) continue
    const inside = contents(group.id, new Set([group.id]))
    for (const result of scene.nodes.values()) {
      if (inside.has(result.id)) continue
      const left = nodeRefs(result.node).find((ref) => ref !== group.id && inside.has(ref))
      if (left === undefined) continue
      const name = (id: string) => scene.nodes.get(id)?.node.name ?? id
      out.push({
        level: 'warning',
        code: 'group.reference',
        nodeId: result.id,
        message: `“${name(result.id)}” refers to “${name(left)}” inside the moved group “${name(group.id)}”, so it stays where “${name(left)}” was built. Put it in the group too.`,
      })
    }
  }
  return out
}
