/**
 * Group: organisational. It always carries its children — their metal, stones, cuts and
 * additions — as its own output (consuming them), and re-publishes their frames as
 * `<child>/<frame>`; the evaluator then applies the group's transform, if it has one, to the
 * whole lot. Because a group always holds what it contains, a group nested in a moved group
 * moves with it, and patterning a group copies everything in it.
 *
 * Nodes outside the group that reference a grouped child (a setting holding a grouped gem, a
 * finding hosted on a grouped body) still see the child where it was built, because references
 * point at nodes, not at the group: dfm/groups.ts reports them when the group moves.
 */
import { defineFeature, type Frame, IDENTITY, type NodeResult } from '../core'
import { type Copy, copyOutput, settingStyles } from './pattern'

export const group = defineFeature('group', (node, ctx) => {
  // A child that could not be built has already reported why; the rest still come along.
  const children = node.children
    .map((id) => ctx.tryInput(id))
    .filter((r): r is NodeResult => r !== null)
  const styles = settingStyles(children)
  const out: Copy = { bodies: [], stones: [], cuts: [], additions: [] }
  const frames: Record<string, Frame> = {}
  // Hidden children stay hidden, and a child another child consumed (a boolean's operand) is
  // already in that child's output: both are consumed, neither is carried twice.
  const inside = new Set(children.flatMap((c) => c.consumes))
  for (const child of children.filter((c) => c.node.visible && !inside.has(c.id))) {
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
