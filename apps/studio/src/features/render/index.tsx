/**
 * Feature folder owned by the render workstream. Contract:
 *  - `PieceRender` — full-bleed piece tab (no page padding).
 *  - `RendersPage` — the /renders page, including its own <PageHeader/>.
 */
import { EmptyState } from '@pave/ui'
import { Column, PageHeader, PageTitle } from '../../components/Page'

export function PieceRender({ pieceId: _pieceId }: { pieceId: string }) {
  return (
    <div className="stage flex h-full min-h-[480px] items-center justify-center">
      <EmptyState
        title="Render studio"
        description="Looks, cameras and photoreal renders of this piece arrive here."
      />
    </div>
  )
}

export function RendersPage() {
  return (
    <>
      <PageHeader crumbs={[{ label: 'Renders' }]} />
      <Column wide>
        <PageTitle title="Renders" description="Every still and animation across your pieces." />
        <EmptyState
          title="No renders yet"
          description="Render a piece from its Render tab and it will appear here."
        />
      </Column>
    </>
  )
}
