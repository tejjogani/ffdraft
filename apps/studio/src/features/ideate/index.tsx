/**
 * Feature folder owned by the ideation workstream. Contract:
 *  - `BoardsPage` — /ideas, including its own <PageHeader/>.
 *  - `BoardPage` — /ideas/:boardId.
 */
import { EmptyState } from '@pave/ui'
import { Column, PageHeader, PageTitle } from '../../components/Page'

export function BoardsPage() {
  return (
    <>
      <PageHeader crumbs={[{ label: 'Ideas' }]} />
      <Column wide>
        <PageTitle
          title="Ideas"
          description="Moodboards of references, sketches and generated concepts."
        />
        <EmptyState
          title="No boards yet"
          description="Collect references from museums, the web and your own sketches."
        />
      </Column>
    </>
  )
}

export function BoardPage({ boardId: _boardId }: { boardId: string }) {
  return (
    <>
      <PageHeader crumbs={[{ label: 'Ideas', link: { to: '/ideas' } }, { label: 'Board' }]} />
      <Column wide>
        <EmptyState
          title="Moodboard"
          description="References and generated concepts arrive here."
        />
      </Column>
    </>
  )
}
