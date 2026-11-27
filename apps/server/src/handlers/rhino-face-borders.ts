import { listRhinoFaceBorders } from '@pave/kernel/rhino-face-borders'
import { badRequest } from '../errors'
import { getPiece } from '../lookups'
import { meshWasReshaped, retainedRhinoBytes, retainedRhinoPart } from './rhino-source'
import type { Handler } from './types'

export const rhinoFaceBorders: Handler<'design.rhinoFaceBorders'> = async (ctx, input) => {
  const { pieceId, nodeId, offset, limit, faceIndex } = input
  const piece = await getPiece(ctx, pieceId)
  const part = retainedRhinoPart(piece.design, nodeId)
  const base = {
    pieceId,
    nodeId,
    version: piece.version,
    nativeAssetId: part?.nativeAssetId ?? null,
  }
  const unsupported = (reason: string) => ({ ...base, faceCount: 0, faces: [], reason })
  if (!part) return unsupported('Select a part with a retained Rhino solid.')
  if (meshWasReshaped(part.node))
    return unsupported('Undo mesh shaping on this part to access its native Rhino face borders.')
  const bytes = await retainedRhinoBytes(ctx, part.nativeAssetId)
  if (!bytes) return unsupported('The retained Rhino solid is unavailable.')
  try {
    return {
      ...base,
      ...(await listRhinoFaceBorders(bytes, {
        offset,
        limit,
        faceIndex,
        nativeTransform: part.source.nativeTransform ?? undefined,
        projectTransform: part.node.transform ?? undefined,
      })),
    }
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'The Rhino face could not be read.')
  }
}
