/**
 * The reference window's Generated tab, shown only when an image model is configured: the concept
 * images made on this piece's design board (and any pinned here), to look at beside CAD or lay in
 * a view. Generating itself happens on the design board, where the request, Claude's prompt and
 * the checks are shown.
 */
import type { Piece, Reference } from '@pave/schema'
import { buttonClass, EmptyState } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { assetUrl } from '../../lib/assets'
import { useRpc } from '../../lib/query'
import { RightsChip } from './Provenance'

export function GeneratedTab({ piece }: { piece: Piece }) {
  const pins = useRpc('references.pins', { pieceId: piece.id })
  const board = useRpc('boards.list', { pieceId: piece.id })
  const designBoard = board.data?.[0] ?? null
  const onBoard = useRpc('boards.get', { id: designBoard?.id ?? '' }, { enabled: !!designBoard })
  const seen = new Set<string>()
  const generated: Reference[] = [
    ...(onBoard.data?.references ?? []),
    ...(pins.data?.references ?? []),
  ].filter((r) => r.type === 'generated' && !seen.has(r.id) && seen.add(r.id))

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-3 pb-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-ai" aria-hidden />
        <p className="text-xs text-fg-subtle">
          Concept images are generated on the design board, where you see the prompt and the checks.
        </p>
      </div>
      <Link
        to="/pieces/$id/directions"
        params={{ id: piece.id }}
        className={buttonClass({ size: 'sm', variant: 'secondary' })}
      >
        Open the design board
      </Link>
      {generated.length ? (
        <ul aria-label="Generated images" className="grid grid-cols-2 gap-2">
          {generated.map((r) => (
            <li key={r.id} className="overflow-hidden rounded-lg shadow-[0_0_0_1px_var(--line)]">
              {r.assetId && (
                <img
                  src={assetUrl(r.assetId, 320)}
                  alt={r.title}
                  className="aspect-square w-full object-cover"
                />
              )}
              <div className="flex items-center justify-between gap-1 p-1.5">
                <span className="truncate text-xs">{r.title || 'Generated'}</span>
                <RightsChip rights={r.rights} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No generated images yet"
          description="Generate concepts on the design board; they show here beside CAD."
        />
      )}
    </div>
  )
}
