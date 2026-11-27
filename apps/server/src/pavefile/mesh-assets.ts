import type { Design, Op } from '@pave/schema'

const SOURCE_ASSET_KEYS = ['assetId', 'nativeAssetId', 'nativeMeshAssetId'] as const
const EDIT_ASSET_KEYS = ['assetId'] as const

type MapAsset = (id: string) => string

function mapIds(value: unknown, keys: readonly string[], map: MapAsset): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const fields = value as Record<string, unknown>
  const mapped: Record<string, string> = {}
  for (const key of keys) {
    const id = fields[key]
    if (typeof id !== 'string') continue
    const next = map(id)
    if (next !== id) mapped[key] = next
  }
  return Object.keys(mapped).length ? { ...fields, ...mapped } : value
}

function mapMeshFields<T extends Record<string, unknown>>(fields: T, map: MapAsset): T {
  const source = mapIds(fields.source, SOURCE_ASSET_KEYS, map)
  const meshEdits = mapIds(fields.meshEdits, EDIT_ASSET_KEYS, map)
  return source === fields.source && meshEdits === fields.meshEdits
    ? fields
    : {
        ...fields,
        ...(source !== fields.source && { source }),
        ...(meshEdits !== fields.meshEdits && { meshEdits }),
      }
}

export function mapDesignMeshAssets(design: Design, map: MapAsset): Design {
  return {
    ...design,
    nodes: Object.fromEntries(
      Object.entries(design.nodes).map(([id, node]) => [
        id,
        node.kind === 'meshBody' ? mapMeshFields(node, map) : node,
      ]),
    ),
  }
}

export function mapOpMeshAssets(op: Op, map: MapAsset): Op {
  if (op.t === 'add' && op.node.kind === 'meshBody')
    return { ...op, node: mapMeshFields(op.node, map) }
  if (op.t === 'update') return { ...op, patch: mapMeshFields(op.patch, map) }
  return op
}

export function meshAssetIds(
  designs: readonly Design[],
  history: readonly { ops: readonly Op[]; inverse: readonly Op[] }[],
): string[] {
  const ids = new Set<string>()
  const collect = (id: string) => {
    ids.add(id)
    return id
  }
  for (const design of designs) mapDesignMeshAssets(design, collect)
  for (const change of history) {
    for (const op of change.ops) mapOpMeshAssets(op, collect)
    for (const op of change.inverse) mapOpMeshAssets(op, collect)
  }
  return [...ids]
}
