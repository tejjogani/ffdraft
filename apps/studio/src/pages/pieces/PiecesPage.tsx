import { PIECE_KINDS, type PieceKind, type PieceSummary, STAGES, type Stage } from '@pave/schema'
import { Badge, Button, EmptyState, InlineError, Segmented, Select, Skeleton } from '@pave/ui'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { FileUp, Folder, LayoutGrid, Plus, Rows3 } from 'lucide-react'
import { useMemo } from 'react'
import { KindGlyph } from '../../components/KindGlyph'
import { Column, PageHeader, PageTitle } from '../../components/Page'
import { PieceCard, PieceCardSkeleton } from '../../components/PieceCard'
import { StageIcon } from '../../components/StageChip'
import { useOpenPaveFile } from '../../features/pavefile'
import { KIND_LABEL, STAGE_LABEL } from '../../lib/domain'
import { plural } from '../../lib/format'
import { useCreatePiece } from '../../lib/pieces'
import { useRpc } from '../../lib/query'
import { PieceTable } from './PieceTable'

export interface PiecesSearch {
  view?: 'gallery' | 'table'
  stage?: Stage
  kind?: PieceKind
  group?: 'none' | 'stage'
  sort?: 'updated' | 'created' | 'title'
}

const SORTS: Record<
  NonNullable<PiecesSearch['sort']>,
  (a: PieceSummary, b: PieceSummary) => number
> = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  title: (a, b) => a.title.localeCompare(b.title),
}

/** All pieces, or one collection's: gallery ⇄ table, filter, group by stage, sort. */
export function PiecesPage({ collectionId }: { collectionId?: string }) {
  const search = useSearch({ strict: false }) as PiecesSearch
  const navigate = useNavigate()
  const setSearch = (patch: Partial<PiecesSearch>) =>
    void navigate({
      to: '.',
      search: (prev: PiecesSearch) => ({ ...prev, ...patch }),
      replace: true,
    })
  const { view = 'gallery', stage, kind, group = 'none', sort = 'updated' } = search

  const collections = useRpc('collections.list', {})
  const collection = collections.data?.find((c) => c.id === collectionId)
  const pieces = useRpc('pieces.list', { collectionId, stage, limit: 200 })
  const create = useCreatePiece()
  const openPaveFile = useOpenPaveFile()

  const visible = useMemo(
    () => (pieces.data ?? []).filter((p) => !kind || p.kind === kind).sort(SORTS[sort]),
    [pieces.data, kind, sort],
  )
  const groups: [Stage | null, PieceSummary[]][] =
    group === 'stage'
      ? STAGES.map(
          (s) => [s, visible.filter((p) => p.stage === s)] as [Stage, PieceSummary[]],
        ).filter(([, l]) => l.length)
      : [[null, visible]]

  const title = collectionId ? (collection?.name ?? 'Collection') : 'Pieces'
  const filtered = !!(stage || kind)

  return (
    <>
      <PageHeader
        crumbs={
          collectionId
            ? [
                { label: 'Pieces', link: { to: '/pieces' } },
                {
                  label: title,
                  icon: collection?.icon ? (
                    <span>{collection.icon}</span>
                  ) : (
                    <Folder className="size-3.5 text-fg-subtle" />
                  ),
                },
              ]
            : [{ label: 'Pieces' }]
        }
        actions={
          <>
            <Button variant="ghost" size="sm" icon={FileUp} onClick={openPaveFile}>
              {/* An icon alone in a phone's header; the name stays for screen readers. */}
              <span className="max-sm:sr-only">Open Pavé file</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Plus}
              onClick={() => create.mutate({ collectionId: collectionId ?? null })}
            >
              New piece
            </Button>
          </>
        }
      />
      <Column wide>
        <PageTitle
          title={title}
          description={
            pieces.data
              ? plural(visible.length, 'piece') + (filtered ? ' matching filters' : '')
              : ' '
          }
        />
        <div className="mb-6 flex flex-wrap items-center gap-1.5 border-b border-line pb-3">
          <Select
            variant="bare"
            aria-label="Filter by stage"
            value={stage ?? 'all'}
            onChange={(v) => setSearch({ stage: v === 'all' ? undefined : (v as Stage) })}
            options={[
              { value: 'all', label: 'All stages' },
              ...STAGES.map((s) => ({
                value: s,
                label: STAGE_LABEL[s],
                icon: <StageIcon stage={s} />,
              })),
            ]}
          />
          <Select
            variant="bare"
            aria-label="Filter by kind"
            value={kind ?? 'all'}
            onChange={(v) => setSearch({ kind: v === 'all' ? undefined : (v as PieceKind) })}
            options={[
              { value: 'all', label: 'All kinds' },
              ...PIECE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
            ]}
          />
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearch({ stage: undefined, kind: undefined })}
            >
              Clear
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Select
              variant="bare"
              aria-label="Group"
              value={group}
              onChange={(v) => setSearch({ group: v })}
              options={[
                { value: 'none', label: 'No grouping' },
                { value: 'stage', label: 'Group by stage' },
              ]}
            />
            <Select
              variant="bare"
              aria-label="Sort"
              value={sort}
              onChange={(v) => setSearch({ sort: v })}
              options={[
                { value: 'updated', label: 'Last edited' },
                { value: 'created', label: 'Newest' },
                { value: 'title', label: 'Title' },
              ]}
            />
            <Segmented
              aria-label="View"
              value={view}
              onChange={(v) => setSearch({ view: v })}
              options={[
                { value: 'gallery', label: 'Gallery', icon: LayoutGrid },
                { value: 'table', label: 'Table', icon: Rows3 },
              ]}
              className="ml-1"
            />
          </div>
        </div>

        {pieces.isError ? (
          <InlineError message={pieces.error.message} onRetry={() => void pieces.refetch()} />
        ) : pieces.isPending ? (
          view === 'gallery' ? (
            <Grid>
              {Array.from({ length: 8 }, (_, i) => (
                <PieceCardSkeleton key={i} />
              ))}
            </Grid>
          ) : (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          )
        ) : visible.length === 0 ? (
          <EmptyState
            visual={<KindGlyph kind="ring" className="w-16" />}
            title={
              filtered ? 'Nothing matches' : collectionId ? 'An empty collection' : 'No pieces yet'
            }
            description={
              filtered
                ? 'Try another stage or kind.'
                : 'Start from a template, or describe a piece to the assistant.'
            }
            action={
              filtered ? (
                <Button onClick={() => setSearch({ stage: undefined, kind: undefined })}>
                  Clear filters
                </Button>
              ) : (
                <Button
                  variant="primary"
                  icon={Plus}
                  onClick={() => create.mutate({ collectionId: collectionId ?? null })}
                >
                  New piece
                </Button>
              )
            }
          />
        ) : (
          <div className="flex flex-col gap-10">
            {groups.map(([s, list]) => (
              <section key={s ?? 'all'} aria-label={s ? STAGE_LABEL[s] : undefined}>
                {s && (
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <StageIcon stage={s} />
                    {STAGE_LABEL[s]}
                    <Badge>{list.length}</Badge>
                  </h2>
                )}
                {view === 'gallery' ? (
                  <Grid>
                    {list.map((p) => (
                      <PieceCard key={p.id} piece={p} />
                    ))}
                  </Grid>
                ) : (
                  <PieceTable pieces={list} collections={collections.data ?? []} />
                )}
              </section>
            ))}
          </div>
        )}
      </Column>
    </>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(184px,1fr))] sm:gap-x-5 sm:gap-y-8">
      {children}
    </div>
  )
}
