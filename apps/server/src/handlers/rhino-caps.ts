import { listRhinoCapFaces, offsetRhinoCap, placeRhinoCapFace } from '@pave/kernel/rhino-cap'
import { putAsset, readAsset } from '../assets/assets'
import { commitChange } from '../design'
import { badRequest, conflict } from '../errors'
import { getPiece } from '../lookups'
import { meshWasReshaped, retainedRhinoPart } from './rhino-source'
import type { Handler } from './types'

const needsRhino = 'Select a part with a retained Rhino solid.'
const needsSource = 'Undo mesh shaping on this part to edit a native end face.'
const unsupported = 'This part needs two matching planar ends and straight walls between them.'

export const rhinoCapFaces: Handler<'design.rhinoCapFaces'> = async (ctx, { pieceId, nodeId }) => {
  const piece = await getPiece(ctx, pieceId)
  const part = retainedRhinoPart(piece.design, nodeId)
  const base = {
    pieceId,
    nodeId,
    version: piece.version,
    nativeAssetId: part?.nativeAssetId ?? null,
  }
  if (!part || meshWasReshaped(part.node))
    return { ...base, faces: [], reason: part ? needsSource : needsRhino }
  const { bytes } = await readAsset(ctx, part.nativeAssetId)
  try {
    const nativeFaces = await listRhinoCapFaces(bytes, part.source.nativeTransform)
    const faces = nativeFaces.map((f) => placeRhinoCapFace(f, part.node.transform))
    return { ...base, faces, reason: faces.length ? null : unsupported }
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'The Rhino solid could not be read.')
  }
}

export const offsetRhinoCapFace: Handler<'design.offsetRhinoCap'> = async (ctx, input) =>
  commitChange(ctx, {
    pieceId: input.pieceId,
    baseVersion: input.baseVersion,
    changeId: input.changeId,
    plan: async (tx, design) => {
      const part = retainedRhinoPart(design, input.nodeId)
      if (!part) throw badRequest(needsRhino)
      if (meshWasReshaped(part.node)) throw badRequest(needsSource)
      if (input.nativeAssetId !== part.nativeAssetId)
        throw conflict('This Rhino solid has changed. Select its face again.')
      const scoped = { ...ctx, repo: tx }
      const native = await readAsset(scoped, part.nativeAssetId)
      const mesh = await readAsset(scoped, part.source.assetId)
      const scale = part.node.transform?.scale ?? 1
      let edit: Awaited<ReturnType<typeof offsetRhinoCap>>
      try {
        edit = await offsetRhinoCap(
          native.bytes,
          mesh.bytes,
          part.source.nativeTransform,
          input.faceIndex,
          input.offsetMm / scale,
        )
      } catch (error) {
        throw badRequest(
          error instanceof Error ? error.message : 'This end face could not be moved.',
        )
      }
      const name = part.node.name ?? 'Rhino solid'
      const solid = await putAsset(scoped, {
        bytes: edit.nativeBytes,
        kind: 'mesh',
        name: name + '.3dm',
        mime: 'model/vnd.3dm',
      })
      const display = await putAsset(scoped, {
        bytes: edit.meshBytes,
        kind: 'mesh',
        name: name + '.stl',
        mime: 'model/stl',
      })
      return {
        label: `Moved end face ${input.faceIndex + 1} by ${input.offsetMm} mm`,
        ops: [
          {
            t: 'update',
            id: part.node.id,
            patch: {
              source: {
                ...part.source,
                assetId: display.id,
                nativeMeshAssetId: display.id,
                nativeAssetId: solid.id,
                nativeTransform: null,
              },
              ...(part.node.meshEdits && { meshEdits: null }),
            },
          },
        ],
      }
    },
  })
