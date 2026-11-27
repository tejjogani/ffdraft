import { poseCircularBand } from '@pave/kernel/circular-band'
import type { Bounds, Evaluation, Part } from '@pave/kernel/types'
import { type Design, importRoleOf, isRhinoRoleBody, type RenderScene } from '@pave/schema'

/** Eligible meshes are already present and visible in the kernel's modeling reference output. */
export function unassignedRhinoBody(
  design: Design | null,
  part: Pick<Part, 'nodeId' | 'modelingSheet'>,
) {
  const node = design?.nodes[part.nodeId]
  return !part.modelingSheet &&
    isRhinoRoleBody(node) &&
    node.visible !== false &&
    importRoleOf(node) === 'unassigned'
    ? node
    : undefined
}

/** Shares mesh buffers with production. Only this view's parts and framing bounds change. */
function includedBodies(
  evaluation: Evaluation,
  design: Design | null,
  includeUnassignedRhino: boolean | undefined,
): Evaluation {
  if (!includeUnassignedRhino) return evaluation
  const parts = evaluation.referenceParts?.filter((part) => unassignedRhinoBody(design, part))
  if (!parts?.length) return evaluation

  const initial =
    evaluation.parts.length || evaluation.stones.length
      ? evaluation.report.bounds
      : parts[0]!.bounds
  const min: Bounds['min'] = [...initial.min]
  const max: Bounds['max'] = [...initial.max]
  for (const { bounds } of parts) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], bounds.min[axis])
      max[axis] = Math.max(max[axis], bounds.max[axis])
    }
  }
  return {
    ...evaluation,
    parts: [...evaluation.parts, ...parts],
    report: { ...evaluation.report, bounds: { min, max } },
  }
}

export function renderEvaluation(
  evaluation: Evaluation,
  design: Design | null,
  includeUnassignedRhino?: boolean,
  pose?: RenderScene['pose'],
): Evaluation {
  const visible = includedBodies(evaluation, design, includeUnassignedRhino)
  return pose === 'circular-band' ? poseCircularBand(visible, design) : visible
}
