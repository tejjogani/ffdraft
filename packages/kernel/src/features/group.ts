/**
 * Group: organisational. Without a transform it contributes nothing — its children evaluate and
 * show as themselves. With one, it moves them as a unit: it consumes its children and carries
 * their metal, stones, cuts and additions (the evaluator then applies the group's transform),
 * and re-publishes their frames as `<child>/<frame>`.
 *
 * Nodes that reference a grouped child directly (a setting holding a grouped gem) still see the
 * child where it was built, because references point at nodes, not at the group: group a
 * setting with its gem when moving them together.
 */
import { type Frame, type NodeResult, defineFeature } from '../core'
import { IDENTITY, composeTransform, isIdentity } from '../geometry/vec'
import { type Copy, copyOutput, settingStyles } from './pattern'

export const group = defineFeature('group', (node, ctx) => {
  const t = node.transform
  if (!t || isIdentity(composeTransform(t.position, t.rotation, t.scale))) return {}
  // A child that could not be built has already reported why; the rest still move.
  const children = node.children.map((id) => ctx.tryInput(id)).filter((r): r is NodeResult => r !== null)
  const styles = settingStyles(children)
  const out: Copy = { bodies: [], stones: [], cuts: [], additions: [] }
  const frames: Record<string, Frame> = {}
  for (const child of children) {
    // Cut and addition targets stay as they are: the evaluator follows `consumes` to the group.
    const copy = copyOutput(child, IDENTITY, (id) => id, styles)
    out.bodies.push(...copy.bodies)
    out.stones.push(...copy.stones)
    out.cuts.push(...copy.cuts)
    out.additions.push(...copy.additions)
    for (const [name, frame] of Object.entries(child.frames)) frames[`${child.id}/${name}`] = frame
  }
  return { ...out, frames, consumes: children.map((c) => c.id) }
})
