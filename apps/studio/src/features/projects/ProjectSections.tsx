/** Project tools and the cost and contents of this piece. */
import { JOB_STAGES, type Piece, type PieceSummary, type ProjectCost } from '@pave/schema'
import { cn } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { useRpc } from '../../lib/query'
import { PROJECT_AREAS, type ProjectArea } from './areas'
import { costLines, holds, STAGE_TITLE, stageStates, stageUsd, usd } from './cost'

export function ProjectSections({ piece }: { piece: Piece }) {
  const summary = useRpc('projects.summary', { pieceIds: [piece.id] })
  const cost = summary.data?.projects.find((p) => p.pieceId === piece.id)
  return (
    <section aria-label="Project" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Project tools</h2>
        <p className="text-sm text-fg-muted">
          Total spent{' '}
          <span className="font-mono text-fg tabular" data-project-total>
            {cost ? usd(cost.totalUsd) : summary.isError ? 'Unavailable' : '…'}
          </span>
        </p>
      </div>
      <nav
        aria-label="Project tools"
        className="flex flex-col divide-y divide-line rounded-lg border border-line"
      >
        {PROJECT_AREAS.map((area) => (
          <AreaCard key={area.to} piece={piece} area={area} cost={cost} />
        ))}
      </nav>
      {cost && cost.otherUsd > 0 && (
        <p className="text-xs text-fg-subtle">
          Plus {usd(cost.otherUsd)} of Claude asked about this project from outside its stages
          (Home, or before it had a stage).
        </p>
      )}
    </section>
  )
}

function AreaCard({ piece, area, cost }: { piece: Piece; area: ProjectArea; cost?: ProjectCost }) {
  const stage = 'stage' in area ? area.stage : null
  const c = stage && cost ? cost[stage] : null
  const Icon = area.icon
  return (
    <Link
      to={area.to}
      params={{ id: piece.id }}
      aria-label={area.title}
      data-stage-section={stage ?? undefined}
      className="flex min-h-12 items-center gap-3 px-4 py-2.5 first:rounded-t-lg last:rounded-b-lg hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{area.title}</span>
        {stage && c && <span className="block text-xs text-fg-subtle">{holds(stage, c)}</span>}
      </span>
      {stage && c && (
        <span className="text-right">
          <span className="font-mono text-xs tabular">{usd(stageUsd(c))}</span>
          <span className="hidden text-xs text-fg-subtle sm:block">
            {costLines(stage, c)
              .map((line) => line.label + ' ' + line.value)
              .join(' · ')}
          </span>
        </span>
      )}
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
