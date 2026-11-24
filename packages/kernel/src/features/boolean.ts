/** Combine bodies: union, subtract or intersect. The operands' own bodies are replaced by the result. */
import {
  type BuildContext,
  defineFeature,
  intersect,
  type NodeResult,
  type Solid,
  subtract,
  union,
} from '../core'

/** A node's metal as one solid. Stays exact when the node has a single exact body. */
function solidOf(result: NodeResult, ctx: BuildContext): Solid {
  const solids = result.bodies.map((b) => b.solid)
  if (solids.length === 0)
    throw new Error(`“${result.node.name ?? result.id}” has no solid to combine`)
  return solids.length === 1 ? solids[0]! : union(solids, { prefer: 'mesh', quality: ctx.quality })
}

export const booleanFeature = defineFeature('boolean', (node, ctx) => {
  const target = ctx.input(node.target)
  const tools = node.tools.map((id) => ctx.input(id))
  const first = target.bodies[0]
  if (!first) throw new Error('the target has no solid')
  // Interactive edits use meshes; production tries the exact B-rep first so the result can be
  // exported as NURBS, and falls back to meshes if the kernel cannot do it.
  const options = {
    prefer: ctx.detail === 'draft' ? 'mesh' : 'exact',
    quality: ctx.quality,
  } as const
  const operands = tools.map((t) => solidOf(t, ctx))
  const base = solidOf(target, ctx)
  const solid =
    node.op === 'union'
      ? union([base, ...operands], options)
      : node.op === 'subtract'
        ? subtract(base, operands, options)
        : intersect(base, operands, options)
  return {
    bodies: [{ solid, material: first.material, finish: first.finish, plating: first.plating }],
    consumes: [node.target, ...node.tools],
  }
})
