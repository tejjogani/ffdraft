import type { Evaluation } from '@pave/kernel/types'
import type { EvaluationSummary } from '@pave/schema'

/** The facts of an evaluation without its meshes: what `design.evaluate` answers. */
export function summarize(evaluation: Evaluation): EvaluationSummary {
  const { report, diagnostics } = evaluation
  const { min, max } = report.bounds
  const surfaces = evaluation.referenceParts
    ?.filter((p) => p.modelingSheet)
    .map((part) => {
      const { min, max } = part.bounds
      return {
        nodeId: part.nodeId,
        areaMm2: part.areaMm2,
        boundsMm: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
      }
    })
  return {
    ...(surfaces?.length && { modelingSurfaces: surfaces }),
    metalMassG: report.metalMassG,
    metals: report.metals.map(({ material, volumeMm3, massG }) => ({ material, volumeMm3, massG })),
    stoneCount: report.stoneCount,
    caratTotal: report.caratTotal,
    lots: report.lots.map(({ cut, stone, width, length, count, caratTotal, setting, role }) => ({
      cut,
      stone,
      width,
      length,
      count,
      caratTotal,
      setting,
      role,
    })),
    boundsMm: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
    diagnostics: diagnostics.map(({ level, code, message, nodeId }) => ({
      level,
      code,
      message,
      ...(nodeId === undefined ? {} : { nodeId }),
    })),
  }
}
