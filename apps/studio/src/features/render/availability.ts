import type { Evaluation } from '@pave/kernel'
import { importRoleOf, isRhinoRoleBody } from '@pave/schema'
import type { PieceEvaluation } from '../../lib/kernel/usePieceEvaluation'

type RenderGeometry = Pick<Evaluation, 'parts' | 'stones' | 'referenceParts'>
type RenderEvaluation = Pick<PieceEvaluation, 'design' | 'status' | 'stale'> & {
  evaluation: RenderGeometry | null
}

export function renderAvailability({ design, evaluation, status, stale }: RenderEvaluation) {
  if (status === 'error' || status === 'unavailable') return 'failed'
  if (status !== 'ready' || stale || !evaluation) return 'pending'
  if (evaluation.parts.length || evaluation.stones.length) return 'ready'
  const references = evaluation.referenceParts ?? []
  const needsReview = references.some(({ nodeId }) => {
    const node = design?.nodes[nodeId]
    return isRhinoRoleBody(node) && node.visible !== false && importRoleOf(node) === 'unassigned'
  })
  if (needsReview) return 'review-roles'
  return references.length ? 'references' : 'empty'
}
