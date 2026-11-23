/**
 * Feature folder owned by the CAD workstream. Contract: export `PieceDesign`, rendered
 * full-bleed (no page padding) under the piece page's tab bar.
 */
import { KindGlyph } from '../../components/KindGlyph'

export function PieceDesign({ pieceId: _pieceId }: { pieceId: string }) {
  return (
    <div className="stage flex h-full min-h-[480px] flex-col items-center justify-center gap-4 text-center">
      <KindGlyph kind="ring" className="w-28 text-fg-subtle" />
      <div>
        <p className="font-serif text-[26px] leading-8">The CAD workspace</p>
        <p className="mt-1 text-sm text-fg-muted">
          Viewport, feature tree and inspector arrive here.
        </p>
      </div>
    </div>
  )
}
