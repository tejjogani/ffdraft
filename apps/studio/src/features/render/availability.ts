import type { Evaluation } from '@pave/kernel'
import { unassignedRhinoBody } from '@pave/render'
import { sourceMaterialLabel } from '@pave/schema'
import type { PieceEvaluation } from '../../lib/kernel/usePieceEvaluation'

type RenderGeometry = Pick<Evaluation, 'parts' | 'stones' | 'referenceParts'>
type RenderEvaluation = Pick<PieceEvaluation, 'design' | 'status' | 'stale'> & {
  evaluation: RenderGeometry | null
}

export function sourceMaterialSummary(
  design: RenderEvaluation['design'],
  references: RenderGeometry['referenceParts'],
) {
  let count = 0
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  for (const part of references ?? []) {
    const body = unassignedRhinoBody(design, part)
    if (!body || seen.has(body.id)) continue
    seen.add(body.id)
    count++
    const label = sourceMaterialLabel(body.source.rhinoContext)
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const labels = [...counts].sort((a, b) => b[1] - a[1])
  const shown = labels.slice(0, 4).map(([label, count]) => `${label} (${count})`)
  if (labels.length > shown.length) shown.push(`+${labels.length - shown.length} more`)
  return { count, labels: shown.join(', ') }
}

export function renderAvailability({ design, evaluation, status, stale }: RenderEvaluation) {
  if (status === 'error' || status === 'unavailable') return 'failed'
  if (status !== 'ready' || stale || !evaluation) return 'pending'
  if (evaluation.parts.length || evaluation.stones.length) return 'ready'
  const references = evaluation.referenceParts ?? []
  const needsReview = references.some((part) => unassignedRhinoBody(design, part))
  if (needsReview) return 'review-roles'
  if (references.some((p) => p.modelingSheet)) return 'sheets'
  return references.length ? 'references' : 'empty'
}
