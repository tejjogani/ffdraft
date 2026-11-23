/**
 * Feature folder owned by the production workstream. Contract: `PieceProduction`, the piece
 * page's "Production" tab (centred column).
 */
import { EmptyState } from '@pave/ui'

export function PieceProduction({ pieceId: _pieceId }: { pieceId: string }) {
  return (
    <EmptyState
      title="Production"
      description="Manufacturer-ready packages — drawings, files, BOM and costing — arrive here."
    />
  )
}
