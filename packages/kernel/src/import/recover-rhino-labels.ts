import type { Design, Node, NodeOf, Op, RhinoContext } from '@pave/schema'
import type { RhinoCurveObject, RhinoImport } from './rhino'

export interface RhinoLabelRecovery {
  ops: Extract<Op, { t: 'update' }>[]
  counts: {
    parts: number
    curves: number
    alreadyLabeled: number
    ambiguous: number
    unmatched: number
    unavailable: number
    unlabeled: number
  }
}

function partKey(id: string, path: readonly string[] = []): string {
  return ['part', id, ...path].join('/').toLowerCase()
}

const curveKey = (id: string) => `curve/${id.toLowerCase()}`

type LabelTarget =
  | { kind: 'part'; id: string; assetId: string; key?: string; context?: RhinoContext }
  | { kind: 'curve'; id: string; curve: NodeOf<'nurbsCurve'>; key: string; context?: RhinoContext }

function labelTarget(node: Node): LabelTarget | undefined {
  if (node.kind === 'meshBody' && node.keepSourcePlacement && node.source.type === 'asset') {
    const { assetId, rhinoObjectId, rhinoInstancePath, rhinoContext, rhinoLayer } = node.source
    if (rhinoObjectId || rhinoLayer || rhinoContext)
      return {
        kind: 'part',
        id: node.id,
        assetId,
        key: rhinoObjectId && partKey(rhinoObjectId, rhinoInstancePath),
        context: rhinoContext,
      }
  }
  if (node.kind === 'nurbsCurve' && node.sourceObjectId)
    return {
      kind: 'curve',
      id: node.id,
      curve: node,
      key: curveKey(node.sourceObjectId),
      context: node.rhinoContext,
    }
  return undefined
}

export function hasRecoverableRhinoLabels(design: Design): boolean {
  return Object.values(design.nodes).some((node) => {
    const target = labelTarget(node)
    return Boolean(target?.key && !target.context?.stullerMaterial)
  })
}

function uniqueBy<T>(items: readonly T[], keyOf: (item: T) => string | undefined) {
  const byKey = new Map<string, T | null>()
  for (const item of items) {
    const key = keyOf(item)
    if (key) byKey.set(key, byKey.has(key) ? null : item)
  }
  return byKey
}

function sameValues(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function sameCurve(a: NodeOf<'nurbsCurve'>, b: RhinoCurveObject): boolean {
  return (
    a.degree === b.degree &&
    sameValues(a.knots, b.knots) &&
    a.controlPoints.length === b.controlPoints.length &&
    a.controlPoints.every((point, i) => sameValues(point, b.controlPoints[i]!))
  )
}

/** Plans metadata-only updates after matching an original Rhino archive to existing project assets. */
export async function recoverRhinoLabels(
  design: Design,
  source: Pick<RhinoImport, 'objects' | 'curves'>,
  loadAsset: (assetId: string) => Promise<Uint8Array>,
  signal?: AbortSignal,
): Promise<RhinoLabelRecovery> {
  const targets = design.order.flatMap((id) => labelTarget(design.nodes[id]!) ?? [])
  const designKeys = uniqueBy(targets, (target) => target.key)
  const parts = uniqueBy(
    source.objects,
    ({ native }) => native && partKey(native.objectId, native.instancePath),
  )
  const curves = uniqueBy(
    source.curves,
    ({ sourceObjectId }) => sourceObjectId && curveKey(sourceObjectId),
  )
  const result: RhinoLabelRecovery = {
    ops: [],
    counts: {
      parts: 0,
      curves: 0,
      alreadyLabeled: 0,
      ambiguous: 0,
      unmatched: 0,
      unavailable: 0,
      unlabeled: 0,
    },
  }
  const { counts, ops } = result

  const recover = async (
    target: LabelTarget,
  ): Promise<RhinoLabelRecovery['ops'][number] | undefined> => {
    signal?.throwIfAborted()
    const { key } = target
    if (!key) {
      counts.unmatched++
      return
    }
    const part = target.kind === 'part' ? parts.get(key) : undefined
    const curve = target.kind === 'curve' ? curves.get(key) : undefined
    const sourceContext = part?.rhinoContext ?? curve?.rhinoContext
    if (target.context && (target.context.stullerMaterial || !sourceContext?.stullerMaterial)) {
      counts.alreadyLabeled++
      return
    }
    if (designKeys.get(key) === null || part === null || curve === null) {
      counts.ambiguous++
      return
    }
    if (!part && !curve) {
      counts.unmatched++
      return
    }
    // A reread generates new group and placement IDs. Keep the project's namespace and
    // add only the supplier fields when the original labels were already saved.
    const context =
      target.context && sourceContext?.stullerMaterial
        ? { ...target.context, stullerMaterial: sourceContext.stullerMaterial }
        : sourceContext
    if (!context) {
      counts.unlabeled++
      return
    }
    if (target.kind === 'part' && part) {
      try {
        const bytes = await loadAsset(target.assetId)
        signal?.throwIfAborted()
        if (!sameValues(bytes, part.bytes)) {
          counts.unmatched++
          return
        }
      } catch {
        signal?.throwIfAborted()
        counts.unavailable++
        return
      }
      counts.parts++
      return { t: 'update', id: target.id, patch: { source: { rhinoContext: context } } }
    }
    if (target.kind === 'curve' && curve && sameCurve(target.curve, curve)) {
      counts.curves++
      return { t: 'update', id: target.id, patch: { rhinoContext: context } }
    }
    counts.unmatched++
  }

  // Keep asset comparisons in project order and avoid retaining all loaded preview meshes at once.
  const batchSize = 4
  for (let start = 0; start < targets.length; start += batchSize) {
    const matched = await Promise.all(targets.slice(start, start + batchSize).map(recover))
    for (const update of matched) if (update) ops.push(update)
  }
  return result
}
