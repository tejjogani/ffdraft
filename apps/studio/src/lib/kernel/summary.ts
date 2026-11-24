/** The facts of an evaluation as the assistant reads them (`EvaluationSummary`), without meshes. */
import type { Evaluation } from '@pave/kernel'
import type { EvaluationSummary } from '@pave/schema'

export function summarize(e: Evaluation): EvaluationSummary {
  const { min, max } = e.report.bounds
  return {
    metalMassG: e.report.metalMassG,
    metals: e.report.metals.map((m) => ({ ...m })),
    stoneCount: e.report.stoneCount,
    caratTotal: e.report.caratTotal,
    lots: e.report.lots.map((l) => ({
      cut: l.cut,
      stone: l.stone,
      width: l.width,
      length: l.length,
      count: l.count,
      caratTotal: l.caratTotal,
      setting: l.setting,
      role: l.role,
    })),
    boundsMm: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
    diagnostics: e.diagnostics.map((d) => ({
      level: d.level,
      code: d.code,
      message: d.message,
      ...(d.nodeId ? { nodeId: d.nodeId } : {}),
    })),
  }
}
