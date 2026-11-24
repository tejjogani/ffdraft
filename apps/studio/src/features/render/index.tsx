/**
 * Feature folder owned by the render workstream. Contract:
 *  - `PieceRender` — full-bleed piece tab (no page padding).
 *  - `RendersPage` — the /renders page, including its own <PageHeader/>.
 */
import { Chip, EmptyState, Skeleton } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Column, PageHeader, PageTitle } from '../../components/Page'
import { assetUrl } from '../../lib/assets'
import { relativeTime } from '../../lib/format'
import { useRpc } from '../../lib/query'
import { RenderStudio } from './RenderStudio'
import { takeLabel } from './shots'

export function PieceRender({ pieceId }: { pieceId: string }) {
  return <RenderStudio pieceId={pieceId} />
}

/** Every finished take across the pieces, newest first; each opens its piece's Render tab. */
export function RendersPage() {
  const takes = useRpc('renders.list', { status: ['done'], limit: 200 })
  const pieces = useRpc('pieces.list', {})
  const title = (id: string) => pieces.data?.find((p) => p.id === id)?.title || 'Untitled'
  return (
    <>
      <PageHeader crumbs={[{ label: 'Renders' }]} />
      <Column wide>
        <PageTitle title="Renders" description="Every take across your pieces." />
        {takes.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : !takes.data?.length ? (
          <EmptyState
            title="No renders yet"
            description="Render a piece from its Render tab and it will appear here."
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {takes.data.map((t) => (
              <li key={t.id}>
                <Link
                  to="/pieces/$id/render"
                  params={{ id: t.pieceId }}
                  className="group block overflow-hidden rounded-lg bg-bg shadow-[0_0_0_1px_var(--line)]"
                >
                  <div className="relative aspect-square bg-bg-muted">
                    {t.assetIds[0] && (
                      <img
                        src={assetUrl(t.assetIds[0], 480)}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    )}
                    <div className="absolute top-1.5 left-1.5 flex gap-1">
                      {t.engine === 'browser' && <Chip className="bg-bg/85">Preview quality</Chip>}
                      {t.stale && (
                        <Chip tone="warn" className="bg-bg/85">
                          Design changed
                        </Chip>
                      )}
                    </div>
                  </div>
                  <div className="px-2.5 py-2">
                    <p className="truncate text-sm font-medium group-hover:underline">
                      {title(t.pieceId)}
                    </p>
                    <p className="truncate text-xs text-fg-subtle">
                      {takeLabel(t)} · {relativeTime(t.createdAt)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Column>
    </>
  )
}
