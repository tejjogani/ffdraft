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
  Spinner,
  Swatch,
  tabClass,
  tabListClass,
} from '@pave/ui'
import { Link, Outlet, useMatchRoute, useNavigate } from '@tanstack/react-router'
import { Copy, Folder, FolderInput, Images, MoreHorizontal, Trash2 } from 'lucide-react'
import { type ReactNode, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { KindGlyph } from '../../components/KindGlyph'
import { Column, PageHeader } from '../../components/Page'
import { StagePicker } from '../../components/StageChip'
import { JobPanel } from '../../features/assistant/jobs/JobPanel'
import { StageStepper } from '../../features/assistant/jobs/StageStepper'
import { StartJob } from '../../features/assistant/jobs/StartJob'
import { DOCK_PANEL_PX, ReferenceDock } from '../../features/references/ReferencePanel'
import { useReferencePanel } from '../../features/references/store'
import { type Command, useRegisterCommands } from '../../lib/commands'
import { KIND_LABEL, metalLabel, metalSwatch } from '../../lib/domain'
import { carats, grams } from '../../lib/format'
import { useDeletePiece, useUpdatePiece } from '../../lib/pieces'
import { useRpc, useRpcMutation } from '../../lib/query'
import { assistant } from '../../stores/assistant'

/** The tabs after the stage stepper (Design → CAD → Render). */
const TABS = [
  { to: '/pieces/$id/on-model', label: 'On model' },
  { to: '/pieces/$id/sourcing', label: 'Sourcing' },
  { to: '/pieces/$id/production', label: 'Production' },
  { to: '/pieces/$id/history', label: 'History' },
] as const

/**
 * The piece page: a Notion-like header (icon, title, properties) above its tabs. The middle
 * tabs are the piece's three stages in order, Design, CAD and Render, each done by hand or by
 * an AI job; a stage's job shows in a bar under the tabs while it wants attention.
 */
export function PiecePage({ id }: { id: string }) {
  const piece = useRpc('pieces.get', { id })
  const matchRoute = useMatchRoute()
  const stage: JobStage | null = matchRoute({ to: '/pieces/$id/directions', params: { id } })
    ? 'design'
    : matchRoute({ to: '/pieces/$id/design', params: { id } })
      ? 'cad'
      : matchRoute({ to: '/pieces/$id/render', params: { id } })
        ? 'render'
        : null
  // CAD and Render are workspaces: the title block folds into the header to give them room.
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
      <PieceHeader piece={p} stage={stage} />
      {!bleed && (
        <Column className="pb-0!">{p ? <PieceHero piece={p} /> : <HeroSkeleton />}</Column>
      )}
      <div className="sticky top-11 z-10 bg-bg">
        <div className={bleed ? '' : 'mx-auto w-full max-w-[880px] px-6 sm:px-12'}>
          <nav aria-label="Piece sections" className={cn(tabListClass, 'gap-4', bleed && 'px-4')}>
            <Link
              to="/pieces/$id"
              params={{ id }}
              activeOptions={{ exact: true }}
              activeProps={{ 'aria-current': 'page' }}
              className={cn(
                tabClass,
                'aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-0 aria-[current=page]:after:-bottom-px aria-[current=page]:after:h-px aria-[current=page]:after:bg-fg',
              )}
            >
              Overview
            </Link>
            {p && <StageStepper piece={p} className="mx-1" />}
            {TABS.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                params={{ id }}
                activeProps={{ 'aria-current': 'page' }}
                className={cn(
                  tabClass,
                  'aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-0 aria-[current=page]:after:-bottom-px aria-[current=page]:after:h-px aria-[current=page]:after:bg-fg',
                )}
              >
                {t.label}
              </Link>
            ))}
            {bleed && p && (
              <div className="ml-auto flex items-center gap-1 pl-3">
                <ReferencesToggle />
                <PieceStage piece={p} />
              </div>
            )}
          </nav>
        </div>
        {p && stage && <JobPanel pieceId={p.id} stage={stage} />}
      </div>
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
  const content = <Suspense fallback={<Spinner className="mx-auto mt-16" />}>{children}</Suspense>
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

function PieceStage({ piece }: { piece: Piece }) {
  const update = useUpdatePiece()
  return (
    <StagePicker stage={piece.stage} onChange={(stage) => update.mutate({ id: piece.id, stage })} />
  )
}

function PieceHeader({ piece, stage }: { piece: Piece | undefined; stage: JobStage | null }) {
  const collections = useRpc('collections.list', {})
  const collection = collections.data?.find((c) => c.id === piece?.collectionId)
  const navigate = useNavigate()
  const remove = useDeletePiece()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const duplicate = useRpcMutation('pieces.duplicate', {
    onSuccess: (copy) => void navigate({ to: '/pieces/$id', params: { id: copy.id } }),
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
          { label: piece ? piece.title || 'Untitled' : '…' },
        ]}
        actions={
          piece && (
            <>
              {/* The stage's AI job: the plan shows before anything starts. */}
              {stage && <StartJob pieceId={piece.id} stage={stage} />}
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
        className="w-full bg-transparent font-serif text-display text-fg placeholder:text-fg-faint outline-none focus-visible:outline-none"
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
        {piece.facts && (
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
