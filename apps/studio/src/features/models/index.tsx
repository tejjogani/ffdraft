/**
 * Feature folder owned by the brand-models workstream. Contract:
 *  - `ModelsPage` — /models, including its own <PageHeader/>.
 *  - `ModelPage` — /models/:id.
 *  - `PieceOnModel` — the piece page's "On model" tab (centred column).
 */
import { EmptyState } from '@pave/ui'
import { Column, PageHeader, PageTitle } from '../../components/Page'

export function ModelsPage() {
  return (
    <>
      <PageHeader crumbs={[{ label: 'Models' }]} />
      <Column wide>
        <PageTitle
          title="Models"
          description="Your brand’s synthetic models, consistent across every shot."
        />
        <EmptyState
          title="No models yet"
          description="Define a model card once; use it for every on-model image."
        />
      </Column>
    </>
  )
}

export function ModelPage({ modelId: _modelId }: { modelId: string }) {
  return (
    <>
      <PageHeader crumbs={[{ label: 'Models', link: { to: '/models' } }, { label: 'Model' }]} />
      <Column>
        <EmptyState
          title="Model card"
          description="Portraits, scale anchors and styling arrive here."
        />
      </Column>
    </>
  )
}

export function PieceOnModel({ pieceId: _pieceId }: { pieceId: string }) {
  return (
    <EmptyState title="On model" description="Show this piece worn by one of your brand models." />
  )
}
