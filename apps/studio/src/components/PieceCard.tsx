import type { PieceSummary } from '@pave/schema'
import type { ReactNode } from 'react'
import { Skeleton } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { factsLine } from '../lib/domain'
import { PieceCover } from './PieceCover'

/** Gallery card: a 4:5 cover, the title, one muted line of facts, and an optional line under it. */
export function PieceCard({ piece, meta }: { piece: PieceSummary; meta?: ReactNode }) {
  return (
    <Link
      to="/pieces/$id"
      params={{ id: piece.id }}
      className="group block rounded-lg outline-offset-4"
    >
      <PieceCover
        piece={piece}
        className="rounded-lg shadow-[0_0_0_1px_var(--line)] transition-[translate,box-shadow] duration-180 ease-out group-hover:-translate-y-0.5 group-hover:shadow-[0_0_0_1px_var(--line-strong),var(--shadow-md)]"
      />
      <div className="mt-2.5 px-0.5">
        <div className="truncate text-sm font-medium text-fg">{piece.title || 'Untitled'}</div>
        <div className="mt-0.5 truncate text-xs text-fg-subtle">{factsLine(piece)}</div>
        {meta && <div className="mt-1.5">{meta}</div>}
      </div>
    </Link>
  )
}

export function PieceCardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[4/5] rounded-lg" />
      <Skeleton className="mt-3 h-3 w-2/3" />
      <Skeleton className="mt-2 h-2.5 w-1/2" />
    </div>
  )
}
