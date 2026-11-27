import type { Bounds, Evaluation } from '@pave/kernel'

export function displayBounds(evaluation: Evaluation): Bounds {
  const { referenceParts = [], report, parts, stones } = evaluation
  if (referenceParts.length === 0) return report.bounds
  const initial = parts.length || stones.length ? report.bounds : referenceParts[0]!.bounds
  const min: Bounds['min'] = [...initial.min]
  const max: Bounds['max'] = [...initial.max]
  for (const { bounds } of referenceParts)
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, bounds.min[axis]!)
      max[axis] = Math.max(max[axis]!, bounds.max[axis]!)
    }
  return { min, max }
}

/** A viewer-local copy through which picks, framing and camera clipping see imported references. */
export function displayEvaluation(evaluation: Evaluation): Evaluation {
  const { referenceParts, ...piece } = evaluation
  if (!referenceParts?.length) return evaluation
  return {
    ...piece,
    parts: [...piece.parts, ...referenceParts],
    report: { ...piece.report, bounds: displayBounds(evaluation) },
  }
}
