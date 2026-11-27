import { placedMeshBounds } from '@pave/kernel/mesh-edit'
import { mountSourcePlacement } from '@pave/kernel/mount-placement'
import type { Design, MountMember, NodeOf } from '@pave/schema'
import { getAssetRow, readAsset } from '../assets/assets'
import type { Ctx } from '../context'
import { AppError, notFound } from '../errors'

export function retainedRhinoPart(design: Design, nodeId: string) {
  if (!Object.hasOwn(design.nodes, nodeId)) throw notFound('Feature', nodeId)
  const node = design.nodes[nodeId]!
  if (
    node.kind !== 'meshBody' ||
    node.source.type !== 'asset' ||
    !node.keepSourcePlacement ||
    !node.source.nativeAssetId ||
    node.source.nativeMeshAssetId !== node.source.assetId
  )
    return null
  return { node, source: node.source, nativeAssetId: node.source.nativeAssetId }
}

export function meshWasReshaped(node: NodeOf<'meshBody'>) {
  return (
    Boolean(node.meshEdits && Object.keys(node.meshEdits.vertices).length) ||
    node.flatBack !== 0 ||
    node.smooth !== 0 ||
    node.hollow !== 0 ||
    node.detail !== 1
  )
}

export async function retainedRhinoBytes(ctx: Ctx, assetId: string) {
  const source = await getAssetRow(ctx, assetId).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) return null
    throw error
  })
  return source && (await ctx.blobs.get(source.sha256))
}

/** Placed source for exact edge and trim reads. A continuous nonlinear bend has no single matrix. */
export async function currentNativePlacement(
  ctx: Ctx,
  design: Design,
  part: NonNullable<ReturnType<typeof retainedRhinoPart>>,
) {
  const { node, source } = part
  if (!node.mountCage && !node.mountFit)
    return { nativeTransform: source.nativeTransform, projectTransform: node.transform }
  let center: [number, number, number] = [0, 0, 0]
  if (node.mountCage?.mode === 'byPart') {
    const { bytes } = await readAsset(ctx, source.assetId)
    const bounds = placedMeshBounds(bytes, node.meshEdits?.vertices, node.transform)
    center = [0, 1, 2].map((i) => (bounds.min[i]! + bounds.max[i]!) / 2) as [number, number, number]
  }
  const nativeTransform = mountSourcePlacement(design, node as MountMember, center)
  return nativeTransform ? { nativeTransform } : null
}
