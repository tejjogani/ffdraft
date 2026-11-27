import type { Design, NodeOf } from '@pave/schema'
import { notFound } from '../errors'

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
