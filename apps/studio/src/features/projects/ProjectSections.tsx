/** Project tools and the cost and contents of this piece. */
import { JOB_STAGES, type Piece, type PieceSummary, type ProjectCost } from '@pave/schema'
import { AiMark, Button, cn } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { CutIcon } from '../../components/CutIcon'
import { KindGlyph } from '../../components/KindGlyph'
import { assetUrl } from '../../lib/assets'
import { useRpc } from '../../lib/query'
import { useSession } from '../../lib/session'
import { openAssistant } from '../../stores/assistant'
import { StartJob } from '../assistant/jobs/StartJob'
import { BuildCadWithClaude } from '../ideate/BuildCadWithClaude'
import { takeMedia } from '../render/shots'
import { PROJECT_AREAS, type ProjectArea } from './areas'
import { costLines, STAGE_TITLE, stageStates, stageUsd, usd } from './cost'

const toolCopy = {
  Designs: ['Design board & spec', 'Gather references and edit the spec.'],
  CAD: ['CAD builder', 'Shape the piece and adjust its settings.'],
  Renders: ['Render studio', 'Set the camera, lighting and backdrop.'],
  Sourcing: ['Stone sourcing', 'Compare diamonds and refit a setting.'],
  'On model': ['On model', 'Choose a model and prepare a shoot.'],
  Production: ['Production', 'Production packages are planned.'],
  History: ['Project history', 'Review or undo a design change.'],
} satisfies Record<ProjectArea['title'], [string, string]>

export function ProjectSections({ piece }: { piece: Piece }) {
  const summary = useRpc('projects.summary', { pieceIds: [piece.id] })
  const boards = useRpc('boards.list', { pieceId: piece.id })
  const renders = useRpc('renders.list', { pieceId: piece.id, limit: 8 })
  const cover = boards.data?.find((b) => b.coverAssetIds.length)?.coverAssetIds[0]
  const take = renders.data?.find((r) => r.status === 'done' && takeMedia(r).still)
  const render = take && takeMedia(take).still
  const cost = summary.data?.projects.find((p) => p.pieceId === piece.id)
  return (
    <section aria-label="Project">
      <ProjectAssistant piece={piece} />
      <h2 className="font-sans text-[18px] font-semibold leading-6 tracking-[-0.025em]">Project tools</h2>
      <nav aria-label="Project tools" className="mt-3 grid grid-cols-2 gap-2 sm:gap-2.5">
        {PROJECT_AREAS.map((area) => {
          const [name, description] = toolCopy[area.title]

          return (
            <Link
              key={area.to}
              to={area.to}
              params={{ id: piece.id }}
              aria-label={name}
              data-tool={area.title}
              data-stage-section={'stage' in area ? area.stage : undefined}
              className="project-tool-card group relative flex min-w-0 flex-col items-start gap-2 rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select sm:min-h-[66px] sm:flex-row sm:items-center sm:gap-3 sm:px-3.5"
            >
              <ToolPreview
                area={area}
                piece={piece}
                image={
                  area.title === 'Designs' ? cover : area.title === 'Renders' ? render : undefined
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block font-sans text-[14px] font-semibold leading-[19px] tracking-[-0.015em]">
                  {name}
                </span>
                <span className="mt-0.5 block text-[13px] leading-[18px] text-[color-mix(in_srgb,var(--fg)_76%,var(--bg))]">
                  {description}
                </span>
              </span>
              <ChevronRight
                className="absolute top-4 right-3 size-3.5 shrink-0 text-fg-muted sm:static sm:size-4"
                aria-hidden
              />
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

function ToolPreview({
  area,
  piece,
  image,
}: {
  area: ProjectArea
  piece: Piece
  image?: string | null
}) {
  const tones = {
    Designs: 'bg-[#f2e8da] text-[#73573c]',
    CAD: 'bg-[#dfe8e7] text-[#22504f]',
    Renders: 'bg-[#333936] text-[#faf7ef]',
    Sourcing: 'bg-[#e4e9f2] text-[#3a5273]',
    History: 'bg-bg-muted text-fg-muted',
    Production: 'bg-bg-muted text-fg-muted',
    'On model': 'bg-bg-muted text-fg-muted',
  }
  const Icon = area.icon
  const gem = piece.design.order.map((id) => piece.design.nodes[id]).find((n) => n?.kind === 'gem')
  return (
    <span
      aria-hidden
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md ring-1 ring-black/10 sm:size-9',
        tones[area.title],
      )}
    >
      {image ? (
        <img className="size-full object-cover" src={assetUrl(image, 160)} alt="" />
      ) : area.title === 'CAD' ? (
        <span className="flex size-full items-center justify-center bg-[linear-gradient(to_right,#22504f12_1px,transparent_1px),linear-gradient(to_bottom,#22504f12_1px,transparent_1px)] bg-[size:9px_9px]">
          <KindGlyph kind={piece.kind} className="w-12" />
        </span>
      ) : area.title === 'Designs' ? (
        <>
          <span className="absolute h-7 w-6 -translate-x-2 rotate-[-13deg] border border-[#bfaa8c] bg-[#fbf6ea]" />
          <span className="relative translate-x-1 rotate-[7deg] border border-[#c8b699] bg-[#fffaf0] shadow-sm">
            <KindGlyph kind={piece.kind} className="w-7" />
          </span>
        </>
      ) : area.title === 'Sourcing' && gem ? (
        <CutIcon cut={gem.cut} className="size-7" />
      ) : (
        <Icon className="size-6" strokeWidth={1.5} />
      )}
    </span>
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
