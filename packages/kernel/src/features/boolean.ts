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

/** The mesh kernel's failures in words a designer can act on; anything else passes through. */
function designerReason(op: 'union' | 'subtract' | 'intersect', error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('Mesh body is empty'))
    return op === 'subtract'
      ? 'nothing is left after the cut: the tools cover the whole body; make them smaller or move them'
      : 'the bodies do not overlap, so nothing is common to them; move them together'
  if (message.startsWith('Surface is not a closed manifold'))
    return 'one of the bodies is not closed (it has holes or loose faces), so it cannot be combined; repair or rebuild it first'
  return message
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
  let solid: Solid
  try {
    solid =
      node.op === 'union'
        ? union([base, ...operands], options)
        : node.op === 'subtract'
          ? subtract(base, operands, options)
          : intersect(base, operands, options)
  } catch (error) {
    throw new Error(designerReason(node.op, error))
  }
  return {
    bodies: [{ solid, material: first.material, finish: first.finish, plating: first.plating }],
    consumes: [node.target, ...node.tools],
  }
})
