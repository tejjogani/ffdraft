import { readEditableMesh } from '@pave/kernel/mesh-edit'
import { type Design, type Op, sameJson } from '@pave/schema'
import { readAsset } from './assets/assets'
import type { Ctx } from './context'
import { badRequest } from './errors'

/** The source asset lookup is scoped to the caller's organization. */
export async function editableMesh(
  ctx: Ctx,
  assetId: string,
  edits?: Record<string, [number, number, number]>,
) {
  const { bytes } = await readAsset(ctx, assetId)
  try {
    return readEditableMesh(bytes, edits)
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : 'Could not read the mesh geometry.')
  }
}

/** Check the affected vertices before history or the new design version is written. */
export async function validateMeshEdits(
  ctx: Ctx,
  before: Design,
  after: Design,
  ops: readonly Op[],
) {
  const changed = new Set(
    ops.flatMap((op) => (op.t === 'add' ? [op.node.id] : op.t === 'update' ? [op.id] : [])),
  )
  for (const id of changed) {
    const node = after.nodes[id]
    if (
      node?.kind !== 'meshBody' ||
      !node.meshEdits ||
      !Object.keys(node.meshEdits.vertices).length
    )
      continue
    const previous = before.nodes[id]
    if (previous?.kind === 'meshBody' && sameJson(previous.meshEdits ?? null, node.meshEdits))
      continue
    await editableMesh(ctx, node.meshEdits.assetId, node.meshEdits.vertices)
  }
}
