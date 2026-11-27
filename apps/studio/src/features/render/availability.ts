import type { Evaluation } from '@pave/kernel'
import { importRoleOf, isRhinoRoleBody, type Node } from '@pave/schema'
import type { PieceEvaluation } from '../../lib/kernel/usePieceEvaluation'

import { sourceMaterialLabel } from '../../lib/source-material'

type RenderGeometry = Pick<Evaluation, 'parts' | 'stones' | 'referenceParts'>
type RenderEvaluation = Pick<PieceEvaluation, 'design' | 'status' | 'stale'> & {
  evaluation: RenderGeometry | null
}

function unassignedBody(node: Node | undefined) {
  return isRhinoRoleBody(node) && node.visible !== false && importRoleOf(node) === 'unassigned'
    ? node
    : undefined
}

export function sourceMaterialSummary(
  design: RenderEvaluation['design'],
  references: RenderGeometry['referenceParts'],
) {
  const counts = new Map<string, number>()
  for (const id of new Set(references?.map(({ nodeId }) => nodeId))) {
    const body = unassignedBody(design?.nodes[id])
    const label = sourceMaterialLabel(body?.source.rhinoContext)
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const labels = [...counts].sort((a, b) => b[1] - a[1])
  const shown = labels.slice(0, 4).map(([label, count]) => `${label} (${count})`)
  if (labels.length > shown.length) shown.push(`+${labels.length - shown.length} more`)
  return shown.join(', ')
}

export function renderAvailability({ design, evaluation, status, stale }: RenderEvaluation) {
  if (status === 'error' || status === 'unavailable') return 'failed'
  if (status !== 'ready' || stale || !evaluation) return 'pending'
  if (evaluation.parts.length || evaluation.stones.length) return 'ready'
  const references = evaluation.referenceParts ?? []
  const needsReview = references.some(({ nodeId }) => unassignedBody(design?.nodes[nodeId]))
  if (needsReview) return 'review-roles'
  if (references.some((p) => p.modelingSheet)) return 'sheets'
  return references.length ? 'references' : 'empty'
}
