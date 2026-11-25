/**
 * A project's three stages as sections, each with what it holds and what it has cost: the
 * design board (Claude and image generations), the CAD (Claude, and Rhino/STEP exports counted
 * against the plan) and the renders (Claude, and Blender renders counted against the plan), and
 * the project's total. Also the small stage-progress marks and cost cell the lists use.
 */
import {
  JOB_STAGES,
  type JobStage,
  type Piece,
  type PieceSummary,
  type ProjectCost,
} from '@pave/schema'
import { cn, Skeleton } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Box, Grid2x2, ImageIcon } from 'lucide-react'
import { STAGE_PATH } from '../assistant/jobs/status'
import { useRpc } from '../../lib/query'
import { costLines, holds, STAGE_TITLE, stageStates, stageUsd, usd } from './cost'

const ICON = { design: Grid2x2, cad: Box, render: ImageIcon } as const

export function ProjectSections({ piece }: { piece: Piece }) {
  const summary = useRpc('projects.summary', { pieceIds: [piece.id] })
  const cost = summary.data?.projects[0]
  return (
    <section aria-label="Project" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Project</h2>
        <p className="text-sm text-fg-muted">
          Total spent{' '}
          <span className="font-mono text-fg tabular" data-project-total>
            {cost ? usd(cost.totalUsd) : '…'}
          </span>
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {JOB_STAGES.map((stage) => (
          <li key={stage}>
            {cost ? (
              <StageSection piece={piece} stage={stage} cost={cost} />
            ) : (
              <Skeleton className="h-36 rounded-lg" />
            )}
          </li>
        ))}
      </ul>
      {cost && cost.otherUsd > 0 && (
        <p className="text-xs text-fg-subtle">
          Plus {usd(cost.otherUsd)} of Claude asked about this project from outside its stages
          (Home, or before it had a stage).
        </p>
      )}
    </section>
  )
}

function StageSection({
  piece,
  stage,
  cost,
}: {
  piece: Piece
  stage: JobStage
  cost: ProjectCost
}) {
  const c = cost[stage]
  const Icon = ICON[stage]
  return (
    <Link
      to={STAGE_PATH[stage]}
      params={{ id: piece.id }}
      aria-label={`${STAGE_TITLE[stage]}: ${holds(stage, c)}, ${usd(stageUsd(c))} spent`}
      data-stage-section={stage}
      className="flex h-full flex-col gap-3 rounded-lg bg-bg p-4 shadow-[0_0_0_1px_var(--line)] hover:shadow-[0_0_0_1px_var(--line-strong)]"
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-fg-muted" aria-hidden />
        <span className="text-sm font-medium">{STAGE_TITLE[stage]}</span>
        <span className="ml-auto font-mono text-sm tabular">{usd(stageUsd(c))}</span>
      </div>
      <p className="text-sm text-fg-muted">{holds(stage, c)}</p>
      <dl className="mt-auto grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
        {costLines(stage, c).map((l) => (
          <div key={l.label} className="contents">
            <dt className="text-fg-subtle">{l.label}</dt>
            <dd className="font-mono tabular">{l.value}</dd>
          </div>
        ))}
      </dl>
    </Link>
  )
}

/** Three small marks, Design · CAD · Render, for a project in a list. */
export function StageProgress({
  piece,
  cost,
}: {
  piece: PieceSummary & Partial<Pick<Piece, 'boardIds'>>
  cost: ProjectCost | undefined
}) {
  const states = stageStates(piece, cost)
  const words = { done: 'done', started: 'started', empty: 'not started' } as const
  return (
    <span
      role="img"
      className="inline-flex items-center gap-1"
      aria-label={JOB_STAGES.map((s) => `${STAGE_TITLE[s]} ${words[states[s]]}`).join(', ')}
      data-stage-progress={JOB_STAGES.map((s) => states[s]).join(',')}
    >
      {JOB_STAGES.map((s) => (
        <span
          key={s}
          aria-hidden
          className={cn(
            'h-1.5 w-4 rounded-full',
            states[s] === 'done'
              ? 'bg-ok'
              : states[s] === 'started'
                ? 'bg-[color-mix(in_oklab,var(--ok)_40%,transparent)]'
                : 'bg-line-strong',
          )}
        />
      ))}
    </span>
  )
}
