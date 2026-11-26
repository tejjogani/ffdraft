import type { Collection, PieceSummary, ProjectCost } from '@pave/schema'
import { Swatch } from '@pave/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { DeleteProjectButton } from '../../components/DeleteProject'
import { KindGlyph } from '../../components/KindGlyph'
import { StageChip } from '../../components/StageChip'
import { usd } from '../../features/projects/cost'
import { projectFolder } from '../../features/projects/folder'
import { StageProgress } from '../../features/projects/ProjectSections'
import { hasFacts, KIND_LABEL, metalLabel, metalSwatch } from '../../lib/domain'
import { carats, grams, relativeTime } from '../../lib/format'

const th = 'h-8 px-3 text-left text-xs font-normal text-fg-subtle whitespace-nowrap'
const td = 'h-10 px-3 whitespace-nowrap'

/** A dense, hairline table. Rows open the piece; the title cell is the link for keyboards. */
export function PieceTable({
  onDelete,
  pieces,
  collections,
  costs,
}: {
  onDelete?: (project: PieceSummary, trigger: HTMLButtonElement) => void
  pieces: PieceSummary[]
  collections: Collection[] | undefined
  /** Each project's costs, by piece id (projects.summary). */
  costs?: ReadonlyMap<string, ProjectCost>
}) {
  const navigate = useNavigate()
  return (
    <div className="-mx-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className={th}>Title</th>
            {onDelete && (
              <th className={th}>
                <span className="sr-only">Project actions</span>
              </th>
            )}
            <th className={th}>Folder</th>
            <th className={th}>Stage</th>
            <th className={th}>Progress</th>
            <th className={`${th} text-right`}>Cost</th>
            <th className={th}>Kind</th>
            <th className={th}>Metal</th>
            <th className={`${th} text-right`}>Weight</th>
            <th className={`${th} text-right`}>Carat</th>
            <th className={`${th} text-right`}>Edited</th>
          </tr>
        </thead>
        <tbody>
          {pieces.map((p) => (
            <tr
              key={p.id}
              onClick={() => void navigate({ to: '/pieces/$id', params: { id: p.id } })}
              className="border-b border-line transition-colors duration-120 hover:bg-bg-hover"
            >
              <td className={`${td} w-full max-w-0`}>
                <Link
                  to="/pieces/$id"
                  params={{ id: p.id }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex min-w-0 items-center gap-2.5 font-medium text-fg outline-offset-2"
                >
                  <span className="stage flex size-6 shrink-0 items-center justify-center rounded-xs shadow-[0_0_0_1px_var(--line)]">
                    <KindGlyph kind={p.kind} className="w-6 text-fg-muted" />
                  </span>
                  <span className="truncate">{p.title || 'Untitled'}</span>
                </Link>
              </td>
              {onDelete && (
                <td className="px-1">
                  <DeleteProjectButton project={p} onSelect={(trigger) => onDelete(p, trigger)} />
                </td>
              )}
              <td className={`${td} text-fg-muted`}>
                {projectFolder(p.collectionId, collections)}
              </td>
              <td className={td}>
                <StageChip stage={p.stage} />
              </td>
              <td className={td}>
                <StageProgress piece={p} cost={costs?.get(p.id)} />
              </td>
              <td className={`${td} text-right font-mono text-xs text-fg-muted tabular`}>
                {costs?.get(p.id) ? usd(costs.get(p.id)!.totalUsd) : '—'}
              </td>
              <td className={`${td} text-fg-muted`}>{KIND_LABEL[p.kind]}</td>
              <td className={`${td} text-fg-muted`}>
                {p.facts ? (
                  <span className="flex items-center gap-1.5">
                    <Swatch
                      color={metalSwatch(p.facts.metal) ?? 'transparent'}
                      kind="metal"
                      size="sm"
                    />
                    {metalLabel(p.facts.metal)}
                  </span>
                ) : (
                  <span className="text-fg-faint">—</span>
                )}
              </td>
              <td className={`${td} text-right font-mono text-xs text-fg-muted tabular`}>
                {hasFacts(p.facts) ? grams(p.facts.metalMassG) : '—'}
              </td>
              <td className={`${td} text-right font-mono text-xs text-fg-muted tabular`}>
                {p.facts?.caratTotal ? carats(p.facts.caratTotal) : '—'}
              </td>
              <td className={`${td} text-right text-xs text-fg-subtle`}>
                {relativeTime(p.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
