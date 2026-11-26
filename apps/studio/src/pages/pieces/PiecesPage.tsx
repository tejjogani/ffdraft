import {
  type Collection,
  type FolderTotal,
  MAX_FOLDER_DEPTH,
  PIECE_KINDS,
  type PieceKind,
  type PieceSummary,
  type ProjectCost,
  STAGES,
  type Stage,
} from '@pave/schema'
import { Badge, Button, EmptyState, InlineError, Segmented, Select, Skeleton } from '@pave/ui'
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router'
import { FileUp, Folder, FolderPlus, LayoutGrid, Plus, Rows3 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DeleteProjectButton, DeleteProjectDialog } from '../../components/DeleteProject'
import { KindGlyph } from '../../components/KindGlyph'
import { Column, PageHeader, PageTitle } from '../../components/Page'
import { PieceCard, PieceCardSkeleton } from '../../components/PieceCard'
import { StageIcon } from '../../components/StageChip'
import { useOpenPaveFile } from '../../features/pavefile'
import { usd } from '../../features/projects/cost'
import { projectFolder } from '../../features/projects/folder'
import { StageProgress } from '../../features/projects/ProjectSections'
import { KIND_LABEL, STAGE_LABEL } from '../../lib/domain'
import { plural } from '../../lib/format'
import { useCanDeleteProject, useCreatePiece } from '../../lib/pieces'
import { useRpc, useRpcMutation } from '../../lib/query'
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

/**
 * All projects (pieces), or one folder's: gallery ⇄ table, filter, group by stage, sort. Each
 * project shows its stage progress and what it has cost; a folder shows its sub-folders with
 * their totals and its own total (sub-folders included).
 */
export function PiecesPage({ collectionId }: { collectionId?: string }) {
  const canDelete = useCanDeleteProject()
  const [deleting, setDeleting] = useState<{
    project: PieceSummary
    trigger: HTMLButtonElement
  } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusProjects = useLocation({
    select: ({ state }) => 'focusProjects' in state && state.focusProjects === true,
  })
  useEffect(() => {
    if (focusProjects) heading.current?.focus()
  }, [focusProjects])
  const onDelete = canDelete
    ? (project: PieceSummary, trigger: HTMLButtonElement) => setDeleting({ project, trigger })
    : undefined
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
  const summary = useRpc('projects.summary', collectionId ? { collectionId } : {})
  const costs = useMemo(
    () => new Map((summary.data?.projects ?? []).map((c) => [c.pieceId, c])),
    [summary.data],
  )
  const subfolders = (collections.data ?? []).filter(
    (c) => collectionId && c.parentId === collectionId,
  )
  const parent = collections.data?.find((c) => c.id === collection?.parentId)
  const folderTotal = summary.data?.folders.find((f) => f.collectionId === collectionId)
  const allTotal = (summary.data?.projects ?? []).reduce((n, p) => n + p.totalUsd, 0)
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

  const title = collectionId ? (collection?.name ?? 'Folder') : 'Projects'
  const filtered = !!(stage || kind)

  return (
    <>
      <PageHeader
        crumbs={
          collectionId
            ? [
                { label: 'Projects', link: { to: '/pieces' } },
                ...(parent
                  ? [
                      {
                        label: parent.name,
                        link: { to: '/collections/$id', params: { id: parent.id } },
                      },
                    ]
                  : []),
                {
                  label: title,
                  icon: collection?.icon ? (
                    <span>{collection.icon}</span>
                  ) : (
                    <Folder className="size-3.5 text-fg-subtle" />
                  ),
                },
              ]
            : [{ label: 'Projects' }]
        }
        actions={
          <>
            <Button variant="ghost" size="sm" icon={FileUp} onClick={openPaveFile}>
              {/* An icon alone in a phone's header; the name stays for screen readers. */}
              <span className="max-sm:sr-only">Open Pavé file</span>
            </Button>
            {collection && !collection.parentId && <NewSubfolder parent={collection} />}
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
          headingRef={heading}
          description={
            pieces.data
              ? plural(visible.length, 'project') +
                (filtered ? ' matching filters' : '') +
                (summary.data
                  ? ` · ${usd(collectionId ? (folderTotal?.totalUsd ?? 0) : allTotal)} spent${collectionId && subfolders.length ? ', its folders included' : ''}`
                  : '')
              : ' '
          }
        />
        {subfolders.length > 0 && (
          <Subfolders folders={subfolders} totals={summary.data?.folders ?? []} />
        )}
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
              filtered
                ? 'Nothing matches'
                : collectionId
                  ? subfolders.length
                    ? 'No projects directly in this folder'
                    : 'An empty folder'
                  : 'No projects yet'
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
                      <div key={p.id} className="relative">
                        <PieceCard
                          piece={p}
                          meta={
                            <>
                              <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                                <Folder className="size-3.5 shrink-0" aria-hidden />
                                {projectFolder(p.collectionId, collections.data)}
                              </span>
                              <ProjectMeta piece={p} cost={costs.get(p.id)} />
                            </>
                          }
                        />
                        {onDelete && (
                          <div className="absolute top-2 right-2 z-1">
                            <DeleteProjectButton
                              project={p}
                              onSelect={(trigger) => onDelete(p, trigger)}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </Grid>
                ) : (
                  <PieceTable
                    onDelete={onDelete}
                    pieces={list}
                    collections={collections.data}
                    costs={costs}
                  />
                )}
              </section>
            ))}
          </div>
        )}
      </Column>
      {deleting && canDelete && (
        <DeleteProjectDialog
          project={deleting.project}
          onClose={() => setDeleting(null)}
          cancelFocus={() => (deleting.trigger.isConnected ? deleting.trigger : heading.current)}
          deletedFocus={() => heading.current}
        />
      )}
    </>
  )
}

/** Under a project's card: its three stages and what it has cost. */
function ProjectMeta({ piece, cost }: { piece: PieceSummary; cost: ProjectCost | undefined }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-fg-subtle">
      <StageProgress piece={piece} cost={cost} />
      <span className="font-mono tabular" data-project-cost>
        {cost ? usd(cost.totalUsd) : '—'}
      </span>
    </div>
  )
}

/** A folder's own folders, each with its totals (its projects, what they cost, the plan's counts). */
function Subfolders({ folders, totals }: { folders: Collection[]; totals: FolderTotal[] }) {
  return (
    <section aria-label="Folders" className="mb-8">
      <h2 className="mb-3 text-sm font-medium">Folders</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {folders.map((f) => {
          const t = totals.find((x) => x.collectionId === f.id)
          return (
            <li key={f.id}>
              <Link
                to="/collections/$id"
                params={{ id: f.id }}
                className="flex flex-col gap-2 rounded-lg bg-bg p-3 shadow-[0_0_0_1px_var(--line)] hover:shadow-[0_0_0_1px_var(--line-strong)]"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Folder className="size-4 text-fg-subtle" aria-hidden />
                  <span className="truncate">{f.name}</span>
                </span>
                <span className="text-xs text-fg-subtle" data-folder-total>
                  {plural(t?.pieceCount ?? 0, 'project')} · {usd(t?.totalUsd ?? 0)}
                  {t?.rendersUsed ? ` · ${plural(t.rendersUsed, 'render')}` : ''}
                  {t?.exportsUsed ? ` · ${plural(t.exportsUsed, 'export')}` : ''}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** A folder inside a top-level folder (two levels at most). */
function NewSubfolder({ parent }: { parent: Collection }) {
  const navigate = useNavigate()
  const create = useRpcMutation('collections.create', {
    onSuccess: (c) => void navigate({ to: '/collections/$id', params: { id: c.id } }),
  })
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={FolderPlus}
      disabled={create.isPending}
      aria-label={`New folder in ${parent.name} (folders go ${MAX_FOLDER_DEPTH} levels deep)`}
      onClick={() => {
        const name = window.prompt('Folder name')?.trim()
        if (name) create.mutate({ name, parentId: parent.id })
      }}
    >
      <span className="max-sm:sr-only">New folder</span>
    </Button>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(184px,1fr))] sm:gap-x-5 sm:gap-y-8">
      {children}
    </div>
  )
}
