import type { Node, NodeOf } from '@pave/schema'
import type { BuildContext, NodeResult } from '../core'
import { composeTransform, IDENTITY, invertSimilarity, type Mat4 } from '../geometry/vec'

export function sourceOf(node: NodeOf<'gem'> | NodeOf<'setting'>, ctx: BuildContext) {
  return node.importSourceId ? ctx.input(node.importSourceId) : undefined
}

export function keepsNativeSurface(result: NodeResult): boolean {
  return (
    result.node.kind === 'meshBody' &&
    (result.data as { nativeMeshUnmodified?: boolean })?.nativeMeshUnmodified === true
  )
}

type Transform = NonNullable<Node['transform']>

/** Takes placed source geometry back to the original girdle frame. */
export function sourceToGirdle(transform: Transform | undefined): Mat4 {
  return transform
    ? invertSimilarity(composeTransform(transform.position, transform.rotation, transform.scale))
    : IDENTITY
}
