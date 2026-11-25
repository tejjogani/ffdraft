/**
 * Projects and folders, in words and numbers: what each stage of a project holds and has cost,
 * and a stage-progress mark for lists. Pure, so the project page, the projects list, folder
 * pages and the tests read the same figures the same way.
 */
import type { JobStage, Piece, PieceSummary, ProjectCost, StageCost } from '@pave/schema'

export const STAGE_TITLE: Record<JobStage, string> = {
  design: 'Design board',
  cad: 'CAD',
  render: 'Renders',
}

/** Money as people read it: cents below $10, whole dollars above, "$0" for nothing spent. */
export function usd(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString('en-US')}`
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What a stage holds, in a few words. */
export function holds(stage: JobStage, c: StageCost): string {
  if (stage === 'design') return c.items ? count(c.items, 'item') : 'Empty'
  if (stage === 'cad') return c.items ? count(c.items, 'change') : 'Not started'
  return c.items ? count(c.items, 'take') : 'No takes yet'
}

/** The lines of a stage's costs: AI spend, image generations, and what the plan counted. */
export function costLines(stage: JobStage, c: StageCost): { label: string; value: string }[] {
  const lines = [{ label: 'Claude', value: usd(c.aiUsd) }]
  if (stage === 'design') lines.push({ label: 'Image generations', value: usd(c.imageUsd) })
  if (stage === 'cad') lines.push({ label: 'Rhino and STEP exports', value: String(c.exportsUsed) })
  if (stage === 'render') lines.push({ label: 'Blender renders', value: String(c.rendersUsed) })
  return lines
}

export const stageUsd = (c: StageCost): number => c.aiUsd + c.imageUsd

export type StageState = 'done' | 'started' | 'empty'

/** Where each stage of a project stands, for the progress marks in lists. */
export function stageStates(
  piece: Pick<PieceSummary, 'stage' | 'facts'> & Partial<Pick<Piece, 'boardIds'>>,
  cost: ProjectCost | undefined,
): Record<JobStage, StageState> {
  const design: StageState = cost?.design.items
    ? 'done'
    : piece.boardIds?.length
      ? 'started'
      : 'empty'
  const built = (piece.facts?.metalMassG ?? 0) > 0 || (cost?.cad.items ?? 0) > 0
  const cad: StageState = built
    ? piece.stage === 'render' || piece.stage === 'production' || piece.stage === 'done'
      ? 'done'
      : 'started'
    : 'empty'
  const render: StageState = cost?.render.items
    ? 'done'
    : piece.stage === 'render'
      ? 'started'
      : 'empty'
  return { design, cad, render }
}
