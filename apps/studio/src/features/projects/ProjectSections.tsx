/** Project tools and the cost and contents of this piece. */
import { JOB_STAGES, type Piece, type PieceSummary, type ProjectCost } from '@pave/schema'
import { AiMark, Button, cn } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useId } from 'react'
import { useRpc } from '../../lib/query'
import { useSession } from '../../lib/session'
import { openAssistant } from '../../stores/assistant'
import { StartJob } from '../assistant/jobs/StartJob'
import { BuildCadWithClaude } from '../ideate/BuildCadWithClaude'
import { PROJECT_AREAS, type ProjectArea } from './areas'
import { costLines, STAGE_TITLE, stageStates, stageUsd, usd } from './cost'

const toolCopy = {
  Designs: ['Design board & spec', 'Collect references and edit the spec.'],
  CAD: ['CAD builder', 'Shape and size the piece.'],
  Renders: ['Render studio', 'Set camera, lighting and backdrop.'],
  Sourcing: ['Stone sourcing', 'Compare stones and refit settings.'],
  'On model': ['On model', 'Choose a model and plan a shoot.'],
  Production: ['Production', 'Production packages are planned.'],
  History: ['Project history', 'Review and undo changes.'],
} satisfies Record<ProjectArea['title'], [string, string]>

export function ProjectSections({ piece }: { piece: Piece }) {
  const summary = useRpc('projects.summary', { pieceIds: [piece.id] })
  const toolId = useId()
  const cost = summary.data?.projects.find((p) => p.pieceId === piece.id)
  return (
    <section aria-label="Project">
      <ProjectAssistant piece={piece} />
      <h2 className="studio-heading">Project tools</h2>
      <nav aria-label="Project tools" className="mt-3 grid grid-cols-2 gap-2">
        {PROJECT_AREAS.map((area, index) => {
          const [name, description] = toolCopy[area.title]
          const descriptionId = `${toolId}-${index}`
          const Icon = area.icon

          return (
            <Link
              key={area.to}
              to={area.to}
              params={{ id: piece.id }}
              aria-label={name}
              aria-describedby={descriptionId}
              data-tool={area.title}
              data-stage-section={'stage' in area ? area.stage : undefined}
              className="flex min-h-16 min-w-0 items-center gap-2 rounded-md border border-line-strong bg-bg-muted px-3 py-2 text-left hover:bg-bg-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select active:border-fg-subtle sm:gap-3"
            >
              <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="studio-option block">{name}</span>
                <span
                  id={descriptionId}
                  className="sr-only sm:not-sr-only sm:mt-0.5 sm:block sm:text-sm sm:leading-4 sm:text-fg-muted"
                >
                  {description}
                </span>
              </span>
              <ChevronRight className="hidden size-4 shrink-0 text-fg-muted sm:block" aria-hidden />
            </Link>
          )
        })}
      </nav>
      {cost && (
        <details className="mt-5 rounded-md border border-line px-4 py-3">
          <summary className="cursor-pointer text-base font-semibold">
            Project spending{' '}
            <span className="ml-2 font-mono" data-project-total>
              {usd(cost.totalUsd)}
            </span>
          </summary>
          <dl className="mt-3 flex flex-col gap-2">
            {JOB_STAGES.map((stage) => (
              <div key={stage}>
                <dt className="text-base font-semibold">
                  {STAGE_TITLE[stage]} · {usd(stageUsd(cost[stage]))}
                </dt>
                <dd className="text-sm text-fg-muted">
                  {costLines(stage, cost[stage])
                    .map((row) => row.label + ' ' + row.value)
                    .join(' · ')}
                </dd>
              </div>
            ))}
          </dl>
          {cost.otherUsd > 0 && (
            <p className="mt-2 text-sm">Other assistant spending {usd(cost.otherUsd)}</p>
          )}
        </details>
      )}
    </section>
  )
}

function ProjectAssistant({ piece }: { piece: Piece }) {
  const enabled = useSession().capabilities.assistant
  return (
    <section
      aria-label="Project assistant"
      className="mb-6 rounded-xl border border-line-strong bg-bg-muted p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <AiMark className="size-5" />
            Project assistant
          </h2>
          <p className="mt-1 text-[13px] text-fg-muted">
            {enabled
              ? 'Ask about this design, change a setting, or plan a render.'
              : 'Connect Claude to discuss this design or plan a CAD edit.'}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <BuildCadWithClaude key={piece.id} pieceId={piece.id} />
          <Button variant="secondary" onClick={() => openAssistant({ pieceId: piece.id })}>
            {enabled ? 'Ask about this project' : 'Project chat'}
          </Button>
        </div>
      </div>
      {enabled && (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-base font-semibold">Plan an AI job</summary>
          <div className="mt-3 flex flex-col items-start gap-2">
            {JOB_STAGES.map((stage) => (
              <StartJob key={stage} pieceId={piece.id} stage={stage} />
            ))}
          </div>
        </details>
      )}
    </section>
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
