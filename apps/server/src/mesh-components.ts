import { placedMeshBounds, readEditableMesh } from '@pave/kernel/mesh-edit'
import { type Design, type MountMember, mountCageContains, type Op, sameJson } from '@pave/schema'
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

export async function measureMountMember(ctx: Ctx, node: MountMember) {
  const { bytes } = await readAsset(ctx, node.source.assetId)
  try {
    return placedMeshBounds(bytes, node.meshEdits?.vertices, node.transform)
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : 'The source mesh could not be measured.')
  }
}

export async function validateMountBounds(ctx: Ctx, node: MountMember) {
  if (!node.mountCage) return
  const bounds = await measureMountMember(ctx, node)
  if (
    !mountCageContains(node.mountCage, bounds.min) ||
    !mountCageContains(node.mountCage, bounds.max)
  ) {
    throw badRequest(
      'The control box must enclose every selected part in its original project position.',
    )
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
    const previous = before.nodes[id]
    if (
      node?.kind === 'meshBody' &&
      node.mountCage &&
      node.source.type === 'asset' &&
      (previous?.kind !== 'meshBody' ||
        previous.source.type !== 'asset' ||
        previous.source.assetId !== node.source.assetId ||
        !sameJson(previous.mountCage ?? null, node.mountCage) ||
        !sameJson(previous.transform ?? null, node.transform ?? null) ||
        !sameJson(previous.meshEdits ?? null, node.meshEdits ?? null))
    ) {
      await validateMountBounds(ctx, node as MountMember)
    }
    if (
      node?.kind !== 'meshBody' ||
      !node.meshEdits ||
      !Object.keys(node.meshEdits.vertices).length
    )
      continue
    if (previous?.kind === 'meshBody' && sameJson(previous.meshEdits ?? null, node.meshEdits))
      continue
    await editableMesh(ctx, node.meshEdits.assetId, node.meshEdits.vertices)
  }
}
