import type { PieceSummary } from '@pave/schema'
import { cn } from '@pave/ui'
import { assetUrl } from '../lib/assets'
import { KindGlyph } from './KindGlyph'

/** The 4:5 stage tile: a rendered cover when one exists, otherwise the kind's line glyph. */
export function PieceCover({
  piece,
  className,
}: {
  piece: Pick<PieceSummary, 'kind' | 'coverAssetId' | 'title'>
  className?: string
}) {
  return (
    <div className={cn('stage relative aspect-[4/5] overflow-hidden', className)}>
      {piece.coverAssetId ? (
        <img
          src={assetUrl(piece.coverAssetId, 480)}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <KindGlyph
          kind={piece.kind}
          className="absolute top-1/2 left-1/2 w-[64%] -translate-x-1/2 -translate-y-1/2 text-fg-muted opacity-80"
        />
      )}
    </div>
  )
}
