import type { JobStage, Piece } from '@pave/schema'
import {
  AiChip,
  Button,
  buttonClass,
  cn,
  Dialog,
  EmptyState,
  IconButton,
  InlineError,
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  Skeleton,
  Swatch,
} from '@pave/ui'
import { Outlet, useMatchRoute, useNavigate } from '@tanstack/react-router'
import { Copy, FileDown, Folder, FolderInput, Images, MoreHorizontal, Trash2 } from 'lucide-react'
import { type ReactNode, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { KindGlyph } from '../../components/KindGlyph'
import { Column, PageHeader } from '../../components/Page'
import { StagePicker } from '../../components/StageChip'
import { JobPanel } from '../../features/assistant/jobs/JobPanel'
import { StartJob } from '../../features/assistant/jobs/StartJob'
import { TryVariants } from '../../features/directions/TryVariants'
import { savePaveFile } from '../../features/pavefile'
import { PROJECT_AREAS, PROJECT_MENU, type ProjectArea } from '../../features/projects/areas'
import { ProjectSwitcher } from '../../features/projects/ProjectSwitcher'
import { DOCK_PANEL_PX, ReferenceDock } from '../../features/references/ReferencePanel'
import { useReferencePanel } from '../../features/references/store'
import { type Command, useRegisterCommands } from '../../lib/commands'
import { hasFacts, KIND_LABEL, metalLabel, metalSwatch } from '../../lib/domain'
import { carats, grams } from '../../lib/format'
import { useDeletePiece, useUpdatePiece } from '../../lib/pieces'
import { useRpc, useRpcMutation } from '../../lib/query'
import { useCurrentView } from '../../lib/use-current-view'
import { assistant } from '../../stores/assistant'

export function PiecePage({ id }: { id: string }) {
  const piece = useRpc('pieces.get', { id })
  const matchRoute = useMatchRoute()
  const area = PROJECT_AREAS.find((item) => matchRoute({ to: item.to, params: { id } }))
  const stage = area && 'stage' in area ? area.stage : null
  const bleed = stage === 'cad' || stage === 'render'

  if (piece.isError)
    return (
      <>
        <PageHeader crumbs={[{ label: 'Pieces', link: { to: '/pieces' } }, { label: 'Piece' }]} />
        <Column>
          {piece.error.status === 404 ? (
            <EmptyState
              className="mt-[10vh]"
              title="Piece not found"
              description="It may have been deleted."
            />
          ) : (
            <InlineError
              className="mt-10"
              message={piece.error.message}
              onRetry={() => void piece.refetch()}
            />
          )}
        </Column>
      </>
    )

  const p = piece.data
  return (
    <div className="flex min-h-full flex-col">
      <PieceHeader piece={p} stage={stage} area={area} />
      {!area && <Column className="pb-0!">{p ? <PieceHero piece={p} /> : <HeroSkeleton />}</Column>}
      {p && stage && (
        <div className="sticky top-11 z-10 bg-bg">
          {bleed && (
            <div className="flex items-center justify-end gap-1 px-3 py-1">
              {stage === 'cad' && <TryVariants piece={p} />}
              <ReferencesToggle />
            </div>
          )}
          <JobPanel pieceId={p.id} stage={stage} />
        </div>
      )}
      <Outlet />
    </div>
  )
}

/**
 * Wraps each tab: workspaces fill the remaining page, with the reference panel beside them;
 * documents sit in the reading column.
 */
export function PieceTab({
  bleed,
  pieceId,
  children,
}: {
  bleed: boolean
  pieceId: string
  children: ReactNode
}) {
  const content = <Suspense fallback={<TabSkeleton bleed={bleed} />}>{children}</Suspense>
  if (bleed) return <Workbench pieceId={pieceId}>{content}</Workbench>
  return <Column className="pt-8">{content}</Column>
}

/** A workspace tab and the reference panel: docked when there is room, else a sheet. */
function Workbench({ pieceId, children }: { pieceId: string; children: ReactNode }) {
  const piece = useRpc('pieces.get', { id: pieceId })
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1440)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={box} className="relative flex min-h-0 flex-1">
      <div className="relative min-w-0 flex-1">{children}</div>
      {piece.data && <ReferenceDock piece={piece.data} docked={width >= DOCK_PANEL_PX} />}
    </div>
  )
}

/** Shows or hides the reference panel (a sheet on narrow screens). */
function ReferencesToggle() {
  const open = useReferencePanel((s) => s.open)
  const toggle = useReferencePanel((s) => s.toggle)
  return (
    <IconButton
      icon={Images}
      label={open ? 'Hide references' : 'Show references'}
      aria-pressed={open}
      onClick={toggle}
    />
  )
}

function PieceStage({ piece, labelled }: { piece: Piece; labelled?: boolean }) {
  const update = useUpdatePiece()
  return (
    <StagePicker
      stage={piece.stage}
      labelled={labelled}
      onChange={(stage) => update.mutate({ id: piece.id, stage })}
    />
  )
}

function PieceHeader({
  piece,
  stage,
  area,
}: {
  piece: Piece | undefined
  stage: JobStage | null
  area?: ProjectArea
}) {
  const collections = useRpc('collections.list', {})
  const collection = collections.data?.find((c) => c.id === piece?.collectionId)
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  const remove = useDeletePiece()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const duplicate = useRpcMutation('pieces.duplicate', {
    onMutate: () => isCurrent,
    onSuccess: (copy, _input, stillHere) =>
      stillHere?.() && void navigate({ to: '/pieces/$id', params: { id: copy.id } }),
  })

  const commands: Command[] = piece
    ? [
        {
          id: 'piece.duplicate',
          title: 'Duplicate piece',
          group: 'Piece',
          icon: Copy,
          run: () => duplicate.mutate({ id: piece.id }),
        },
        {
          id: 'piece.saveFile',
          title: 'Save as Pavé file',
          group: 'Piece',
          icon: FileDown,
          keywords: ['export', 'download', '.pave', 'file'],
          run: () => void savePaveFile(piece),
        },
        {
          id: 'piece.delete',
          title: 'Delete piece',
          group: 'Piece',
          icon: Trash2,
          run: () => setConfirmDelete(true),
        },
        {
          id: 'piece.ask',
          title: 'Ask the assistant about this piece',
          group: 'Assistant',
          run: () => assistant.open({ context: { pieceId: piece.id } }),
        },
      ]
    : []
  useRegisterCommands(commands)

  return (
    <>
      <PageHeader
        crumbs={[
          collection
            ? {
                label: collection.name,
                link: { to: '/collections/$id', params: { id: collection.id } },
              }
            : { label: 'Pieces', link: { to: '/pieces' } },
          {
            label: piece ? piece.title || 'Untitled' : '…',
            link: piece && area ? { to: PROJECT_MENU, params: { id: piece.id } } : undefined,
          },
          ...(area
            ? [
                {
                  label: (
                    <>
                      <span className="md:hidden">{piece?.title || 'Untitled'} · </span>
                      {area.title}
                    </>
                  ),
                },
              ]
            : []),
        ]}
        actions={
          piece && (
            <>
              <ProjectSwitcher pieceId={piece.id} area={area} />
              {/* The stage's AI job: the plan shows before anything starts. */}
              {stage && <StartJob key={stage} pieceId={piece.id} stage={stage} />}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => assistant.open({ context: { pieceId: piece.id } })}
              >
                <AiChip>Ask</AiChip>
              </Button>
              <Menu
                trigger={<IconButton icon={MoreHorizontal} label="Piece options" />}
                align="end"
              >
                <MenuItem icon={Copy} onClick={() => duplicate.mutate({ id: piece.id })}>
                  Duplicate
                </MenuItem>
                <MenuItem
                  icon={FileDown}
                  description="Free, never counted"
                  onClick={() => void savePaveFile(piece)}
                >
                  Save as Pavé file
                </MenuItem>
                <MenuSub label="Move to collection" icon={FolderInput}>
                  <CollectionChoices piece={piece} />
                </MenuSub>
                <MenuSeparator />
                <MenuItem icon={Trash2} danger onClick={() => setConfirmDelete(true)}>
                  Delete
                </MenuItem>
              </Menu>
            </>
          )
        }
      />
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this piece?"
        description="Its design, history, renders and packages will be deleted. This can’t be undone."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => piece && remove.mutate({ id: piece.id })}
            >
              Delete piece
            </Button>
          </>
        }
      />
    </>
  )
}

function PieceHero({ piece }: { piece: Piece }) {
  const update = useUpdatePiece()
  const collections = useRpc('collections.list', {})
  const [title, setTitle] = useState(piece.title)
  useEffect(() => setTitle(piece.title), [piece.title])
  const metal = piece.facts?.metal ?? piece.spec?.metal.alloy
  const commitTitle = () => {
    const next = title.trim()
    if (next !== piece.title) update.mutate({ id: piece.id, title: next })
  }

  return (
    <div className="pt-12 pb-5">
      <div className="stage mb-5 flex h-[70px] w-14 items-center justify-center overflow-hidden rounded-md shadow-[0_0_0_1px_var(--line)]">
        <KindGlyph kind={piece.kind} className="w-16 shrink-0 text-fg-muted" />
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setTitle(piece.title)
            requestAnimationFrame(() => e.currentTarget?.blur())
          }
        }}
        placeholder="Untitled"
        aria-label="Piece title"
        maxLength={120}
        className="w-full bg-transparent font-serif text-title text-fg placeholder:text-fg-faint outline-none focus-visible:outline-none sm:text-display"
      />
      <div className="mt-4 -ml-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
        <PieceStage piece={piece} />
        <Property>{KIND_LABEL[piece.kind]}</Property>
        {metal && (
          <Property>
            <Swatch color={metalSwatch(metal) ?? 'transparent'} kind="metal" size="sm" />
            {metalLabel(metal)}
          </Property>
        )}
        <Menu
          trigger={
            <button
              type="button"
              className={cn(buttonClass({ variant: 'ghost', size: 'sm' }), 'px-1.5 font-normal')}
            >
              <Folder aria-hidden />
              {collections.data?.find((c) => c.id === piece.collectionId)?.name ?? 'No collection'}
            </button>
          }
        >
          <CollectionChoices piece={piece} />
        </Menu>
        {hasFacts(piece.facts) && (
          <div className="ml-auto flex items-center gap-4 pl-4 font-mono text-xs text-fg-muted tabular">
            <Fact label="Metal">{grams(piece.facts.metalMassG)}</Fact>
            {piece.facts.stoneCount > 0 && (
              <Fact label="Total">{carats(piece.facts.caratTotal)}</Fact>
            )}
            {piece.facts.stoneCount > 0 && <Fact label="Stones">{piece.facts.stoneCount}</Fact>}
          </div>
        )}
      </div>
    </div>
  )
}

/** Radio items for moving a piece between collections (used in two menus). */
function CollectionChoices({ piece }: { piece: Piece }) {
  const update = useUpdatePiece()
  const collections = useRpc('collections.list', {})
  return (
    <MenuRadioGroup
      value={piece.collectionId ?? 'none'}
      onChange={(v) => update.mutate({ id: piece.id, collectionId: v === 'none' ? null : v })}
    >
      <MenuRadioItem value="none">No collection</MenuRadioItem>
      {collections.data?.map((c) => (
        <MenuRadioItem key={c.id} value={c.id}>
          {c.name}
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  )
}

function Property({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 px-1.5 text-fg-muted">{children}</span>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-sans text-fg-subtle">{label}</span>
      <span className="text-fg">{children}</span>
    </span>
  )
}

function HeroSkeleton() {
  return (
    <div className="pt-12 pb-5">
      <Skeleton className="mb-5 h-[70px] w-14 rounded-md" />
      <Skeleton className="h-11 w-2/3" />
      <Skeleton className="mt-5 h-6 w-1/2" />
    </div>
  )
}

/** A tab's code is loading: the shape of what comes, not a spinner. */
function TabSkeleton({ bleed }: { bleed: boolean }) {
  if (bleed) return <div className="stage absolute inset-0" aria-busy="true" />
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}
