/**
 * Feature folder owned by the sourcing workstream. Contract:
 *  - `SourcingPage` — /sourcing, including its own <PageHeader/>.
 *  - `PieceSourcing` — the piece page's "Sourcing" tab (centred column).
 */
import { EmptyState } from '@pave/ui'
import { Column, PageHeader, PageTitle } from '../../components/Page'

export function SourcingPage() {
  return (
    <>
      <PageHeader crumbs={[{ label: 'Sourcing' }]} />
      <Column wide>
        <PageTitle title="Sourcing" description="Stones and findings matched to your designs." />
        <EmptyState
          title="Nothing to source yet"
          description="Stone lots from your pieces will be matched to supplier inventory here."
        />
      </Column>
    </>
  )
}

export function PieceSourcing({ pieceId: _pieceId }: { pieceId: string }) {
  return (
    <EmptyState title="Sourcing" description="Match this piece’s stone lots to real inventory." />
  )
}
