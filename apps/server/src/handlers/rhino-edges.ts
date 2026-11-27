import { inspectRhinoEdges } from '@pave/kernel/rhino-edges'
import { getAssetRow } from '../assets/assets'
import { AppError, badRequest } from '../errors'
import { getPiece } from '../lookups'
import { meshWasReshaped, retainedRhinoPart } from './rhino-source'
import type { Handler } from './types'

export const rhinoEdges: Handler<'design.rhinoEdges'> = async (ctx, input) => {
  const { pieceId, nodeId, offset, limit, edgeIndex } = input
  const piece = await getPiece(ctx, pieceId)
  const part = retainedRhinoPart(piece.design, nodeId)
  const base = {
    pieceId,
    nodeId,
    version: piece.version,
    nativeAssetId: part?.nativeAssetId ?? null,
  }
  const unsupported = (reason: string) => ({ ...base, edgeCount: 0, edges: [], reason })
  if (!part) return unsupported('Select a part with a retained Rhino solid.')
  if (meshWasReshaped(part.node))
    return unsupported('Undo mesh shaping on this part to access its native Rhino edges.')

  const source = await getAssetRow(ctx, part.nativeAssetId).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) return null
    throw error
  })
  const bytes = source && (await ctx.blobs.get(source.sha256))
  if (!bytes) return unsupported('The retained Rhino solid is unavailable.')
  try {
    return {
      ...base,
      ...(await inspectRhinoEdges(bytes, {
        offset,
        limit,
        edgeIndex,
        nativeTransform: part.source.nativeTransform ?? undefined,
        projectTransform: part.node.transform ?? undefined,
      })),
    }
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'The Rhino edge could not be read.')
  }
}
