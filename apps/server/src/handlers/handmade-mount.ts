import {
  customMountFitForStone,
  customMountPartIssue,
  type Design,
  importRoleOf,
  type MountFit,
  type MountMember,
  type Op,
  sameJson,
} from '@pave/schema'
import { commitChange } from '../design'
import { badRequest } from '../errors'
import { getPiece } from '../lookups'
import { measureMountMember } from '../mesh-components'
import type { Handler } from './types'

function member(design: Design, id: string): MountMember {
  const issue = customMountPartIssue(design, id)
  if (issue) throw badRequest(issue)
  return design.nodes[id] as MountMember
}

export const inspectMount: Handler<'design.inspectMount'> = async (ctx, { pieceId, nodeIds }) => {
  const { design, version } = await getPiece(ctx, pieceId)
  const parts = []
  const bounds: { min: [number, number, number]; max: [number, number, number] } = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  }
  for (const id of nodeIds) {
    const body = member(design, id)
    const box = await measureMountMember(ctx, body)
    parts.push({
      nodeId: id,
      assetId: body.source.assetId,
      bounds: box,
      native:
        !!body.source.nativeAssetId &&
        body.source.nativeMeshAssetId === body.source.assetId &&
        !Object.keys(body.meshEdits?.vertices ?? {}).length,
    })
    for (const k of [0, 1, 2] as const) {
      bounds.min[k] = Math.min(bounds.min[k], box.min[k])
      bounds.max[k] = Math.max(bounds.max[k], box.max[k])
    }
  }
  return { version, parts, bounds }
}

export const editMount: Handler<'design.editMount'> = async (ctx, input) =>
  commitChange(ctx, {
    pieceId: input.pieceId,
    baseVersion: input.baseVersion,
    changeId: input.changeId,
    plan: async (_tx, design) => {
      let fit: MountFit | undefined
      if (input.fitGemId != null) {
        try {
          fit = customMountFitForStone(design, input.fitGemId)
        } catch (e) {
          throw badRequest(
            e instanceof Error ? e.message : 'Choose a confirmed stone in this project.',
          )
        }
      }
      const ops: Op[] = []
      for (const id of input.nodeIds) {
        const node = member(design, id)
        const role = importRoleOf(node)
        const patch: Record<string, unknown> = {}
        if (role !== undefined && role !== 'metal') {
          if (!input.material)
            throw badRequest('Choose a casting alloy for each unassigned or reference member.')
          patch.importRole = 'metal'
        }
        if (input.material && input.material !== node.material) patch.material = input.material
        if (input.cage !== undefined && !sameJson(node.mountCage ?? null, input.cage))
          patch.mountCage = input.cage
        if (input.fitGemId !== undefined && !sameJson(node.mountFit ?? null, fit ?? null))
          patch.mountFit = fit ?? null
        if (Object.keys(patch).length) ops.push({ t: 'update', id, patch })
      }
      if (!ops.length)
        throw badRequest('These mount parts already have the selected shape, stone link and alloy.')
      const count = ops.length
      return { ops, label: `Edited ${count} handmade mount ${count === 1 ? 'part' : 'parts'}` }
    },
  })
