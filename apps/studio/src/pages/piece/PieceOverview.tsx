import type { Piece } from '@pave/schema'
import { Button, Skeleton, Textarea } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { ImageIcon, Lightbulb, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SectionTitle } from '../../components/Page'
import { SpecCard } from '../../components/SpecCard'
import { ProjectSections } from '../../features/projects/ProjectSections'
import { takeMedia } from '../../features/render/shots'
import { assetUrl } from '../../lib/assets'
import { dateTime, plural, relativeTime } from '../../lib/format'
import { useUpdatePiece } from '../../lib/pieces'
import { useRpc, useRpcMutation } from '../../lib/query'

export function PieceOverview({ pieceId }: { pieceId: string }) {
  const piece = useRpc('pieces.get', { id: pieceId })
  if (!piece.data)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  return (
    <div className="flex flex-col gap-10">
      <Brief piece={piece.data} />
      <ProjectSections piece={piece.data} />
      <SpecCard piece={piece.data} />
      <Moodboards pieceId={pieceId} />
      <LatestRenders pieceId={pieceId} />
      {piece.data.provenance && <FileProvenance provenance={piece.data.provenance} />}
    </div>
  )
}

/** Where a piece opened from a .pave file came from: the saves it travelled through. */
function FileProvenance({ provenance }: { provenance: NonNullable<Piece['provenance']> }) {
  const last = provenance.files[provenance.files.length - 1]!
  return (
    <section aria-label="Where this piece came from">
      <SectionTitle>Where it came from</SectionTitle>
      <p className="text-sm text-fg-muted">
        Opened from <span className="text-fg">{provenance.fileName}</span>{' '}
        {relativeTime(provenance.openedAt)}, saved{' '}
        {provenance.elsewhere ? 'by another organisation or install' : 'here'} with Pavé{' '}
        {last.appVersion} on {dateTime(last.savedAt)}. First made {dateTime(provenance.createdAt)}
        {provenance.files.length > 1 ? `; saved to a file ${provenance.files.length} times` : ''}.
        Its history keeps who made each change.
      </p>
    </section>
  )
}

export function Brief({ piece }: { piece: Piece }) {
  const update = useUpdatePiece()
  const [brief, setBrief] = useState(piece.brief)
  useEffect(() => setBrief(piece.brief), [piece.brief])
  return (
    <section aria-label="Brief">
      <Textarea
        bare
        minRows={2}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        onBlur={() => brief !== piece.brief && update.mutate({ id: piece.id, brief })}
        placeholder="Write a brief — who it’s for, the feeling, the constraints…"
        aria-label="Brief"
        className="text-lg leading-7 placeholder:text-fg-faint"
      />
    </section>
  )
}

export function Moodboards({ pieceId }: { pieceId: string }) {
  const boards = useRpc('boards.list', { pieceId })
  const create = useRpcMutation('boards.create')
  return (
    <section>
      <SectionTitle
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={Plus}
            onClick={() => create.mutate({ title: 'Untitled board', pieceId })}
          >
            New board
          </Button>
        }
      >
        Moodboards
      </SectionTitle>
      {boards.isPending ? (
        <Skeleton className="h-14" />
      ) : !boards.data?.length ? (
        <p className="text-sm text-fg-subtle">No moodboards linked to this piece.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {boards.data.map((b) => (
            <Link
              key={b.id}
              to="/ideas/$boardId"
              params={{ boardId: b.id }}
              className="flex items-center gap-3 rounded-lg p-2 shadow-[0_0_0_1px_var(--line)] transition-shadow hover:shadow-[0_0_0_1px_var(--line-strong)]"
            >
              <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-muted">
                {b.coverAssetIds[0] ? (
                  <img
                    src={assetUrl(b.coverAssetIds[0], 120)}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <Lightbulb className="size-4 text-fg-subtle" aria-hidden />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{b.title}</span>
                <span className="block text-xs text-fg-subtle">
                  {plural(b.referenceCount, 'reference')} · {relativeTime(b.updatedAt)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

function LatestRenders({ pieceId }: { pieceId: string }) {
  const renders = useRpc('renders.list', { pieceId, limit: 8 })
  const done = renders.data?.filter((r) => r.status === 'done' && takeMedia(r).still) ?? []
  return (
    <section>
      <SectionTitle
        actions={
          <Link
            to="/pieces/$id/render"
            params={{ id: pieceId }}
            className="text-xs text-fg-muted hover:text-fg"
          >
            Open render studio
          </Link>
        }
      >
        Latest renders
      </SectionTitle>
      {renders.isPending ? (
        <Skeleton className="h-32" />
      ) : done.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-fg-subtle">
          <ImageIcon className="size-4" aria-hidden /> No renders yet.
        </div>
      ) : (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {done.map((r) => (
            <img
              key={r.id}
              src={assetUrl(takeMedia(r).still ?? r.assetIds[0]!, 320)}
              alt={r.title}
              loading="lazy"
              className="stage aspect-square w-36 shrink-0 rounded-lg object-cover shadow-[0_0_0_1px_var(--line)]"
            />
          ))}
        </div>
      )}
    </section>
  )
}
