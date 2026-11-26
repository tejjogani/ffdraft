/** Project tools and the cost and contents of this piece. */
import { JOB_STAGES, type Piece, type PieceSummary, type ProjectCost } from '@pave/schema'
import { cn } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { CutIcon } from '../../components/CutIcon'
import { KindGlyph } from '../../components/KindGlyph'
import { assetUrl } from '../../lib/assets'
import { useRpc } from '../../lib/query'
import { takeMedia } from '../render/shots'
import { PROJECT_AREAS, type ProjectArea } from './areas'
import { costLines, STAGE_TITLE, stageStates, stageUsd, usd } from './cost'

const toolCopy = {
  Designs: [
    'Design board & spec',
    'Collect reference images and edit the materials, stones and sizes.',
  ],
  CAD: ['CAD builder', 'Open the 3D model to shape the piece and adjust its settings.'],
  Renders: ['Render studio', 'Frame the piece, set the lighting and make a product image.'],
  Sourcing: ['Stone sourcing', 'Find diamonds for a setting and compare their measurements.'],
  'On model': ['On model', 'Prepare a photograph of the piece being worn.'],
  Production: ['Production', 'Production packages are planned.'],
  History: ['Project history', 'Review design changes and undo an edit.'],
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
      <h2 className="text-[28px] font-bold leading-tight tracking-tight">Project tools</h2>
      <p className="mt-1.5 mb-5 text-[15px] text-fg-muted">
        Choose what you’d like to work on. Each tool opens in this project.
      </p>
      <nav aria-label="Project tools" className="flex flex-col gap-4">
        {PROJECT_AREAS.map((area) => {
          const [name, description] = toolCopy[area.title]

          return (
            <Link
              key={area.to}
              to={area.to}
              params={{ id: piece.id }}
              aria-label={name}
              data-stage-section={'stage' in area ? area.stage : undefined}
              className="group flex min-h-[104px] items-center gap-4 rounded-xl border border-line-strong bg-bg p-4 shadow-sm hover:border-fg-muted hover:bg-bg-subtle focus-visible:outline-2 sm:min-h-[115px] sm:gap-6 sm:p-5"
            >
              <ToolPreview
                area={area}
                piece={piece}
                image={
                  area.title === 'Designs' ? cover : area.title === 'Renders' ? render : undefined
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[21px] font-semibold leading-7 tracking-tight sm:text-[24px]">
                  {name}
                </span>
                <span className="mt-1 block text-[15px] leading-5 text-fg-muted">
                  {description}
                </span>
              </span>
              <ArrowUpRight className="size-5 shrink-0 text-fg-muted" aria-hidden />
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
        'relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md sm:h-[76px] sm:w-24',
        tones[area.title],
      )}
    >
      {image ? (
        <img className="size-full object-cover" src={assetUrl(image, 160)} alt="" />
      ) : area.title === 'CAD' ? (
        <span className="flex size-full items-center justify-center bg-[linear-gradient(to_right,#22504f12_1px,transparent_1px),linear-gradient(to_bottom,#22504f12_1px,transparent_1px)] bg-[size:9px_9px]">
          <KindGlyph kind={piece.kind} className="w-16" />
        </span>
      ) : area.title === 'Designs' ? (
        <>
          <span className="absolute h-10 w-8 -translate-x-2 rotate-[-13deg] border border-[#bfaa8c] bg-[#fbf6ea]" />
          <span className="relative translate-x-1 rotate-[7deg] border border-[#c8b699] bg-[#fffaf0] shadow-sm">
            <KindGlyph kind={piece.kind} className="w-10" />
          </span>
        </>
      ) : area.title === 'Sourcing' && gem ? (
        <CutIcon cut={gem.cut} className="size-10" />
      ) : (
        <Icon className="size-8" strokeWidth={1.5} />
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
