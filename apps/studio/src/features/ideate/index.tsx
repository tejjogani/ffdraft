/**
 * Ideas: design boards on their own (`/ideas`, `/ideas/:boardId`). A board may be linked to a
 * project, where it is that project's Design stage; it can be linked, unlinked and started as
 * CAD at any time. Contract:
 *  - `BoardsPage`: /ideas, including its own <PageHeader/>.
 *  - `BoardPage`: /ideas/:boardId.
 */
import type { Board } from '@pave/schema'
import { TEMPLATES } from '@pave/schema'
import {
  Button,
  EmptyState,
  InlineError,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuSub,
  Skeleton,
} from '@pave/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { Hammer, LayoutTemplate, Link2, Plus, Unlink } from 'lucide-react'
import { Column, PageHeader, PageTitle } from '../../components/Page'
import { assetUrl } from '../../lib/assets'
import { invalidateFor, queryClient, useRpc, useRpcMutation } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { DesignBoard } from './DesignBoard'

export { DesignBoard } from './DesignBoard'

export function BoardsPage() {
  const boards = useRpc('boards.list', {})
  const navigate = useNavigate()
  const create = useRpcMutation('boards.create', {
    onSuccess: (b) => void navigate({ to: '/ideas/$boardId', params: { boardId: b.id } }),
  })
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Ideas' }]}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={() => create.mutate({ title: 'New board' })}
          >
            New board
          </Button>
        }
      />
      <Column wide>
        <PageTitle
          title="Ideas"
          description="Design boards: pictures, sketches, notes and models to think with. Link one to a project, or take a picture from it to CAD."
        />
        {boards.isError ? (
          <InlineError message={boards.error.message} onRetry={() => void boards.refetch()} />
        ) : !boards.data ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-[4/3] rounded-lg" />
            ))}
          </div>
        ) : boards.data.length === 0 ? (
          <EmptyState
            title="No boards yet"
            description="Start one here, or open a project’s Design stage: its board is made with it."
          />
        ) : (
          <ul aria-label="Boards" className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {boards.data.map((b) => (
              <li key={b.id}>
                <BoardCard board={b} />
              </li>
            ))}
          </ul>
        )}
      </Column>
    </>
  )
}

function BoardCard({ board }: { board: Board }) {
  return (
    <Link
      to="/ideas/$boardId"
      params={{ boardId: board.id }}
      className="block overflow-hidden rounded-lg bg-bg shadow-[0_0_0_1px_var(--line)] hover:shadow-[0_0_0_1px_var(--line-strong)]"
    >
      <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-px bg-line">
        {[0, 1, 2, 3].map((i) => {
          const id = board.coverAssetIds[i]
          return id ? (
            <img
              key={i}
              src={assetUrl(id, 240)}
              alt=""
              className="size-full bg-bg-muted object-cover"
            />
          ) : (
            <div key={i} className="bg-bg-muted" />
          )
        })}
      </div>
      <div className="px-3 py-2">
        <p className="truncate text-sm font-medium">{board.title}</p>
        <p className="text-xs text-fg-subtle">
          {board.referenceCount} {board.referenceCount === 1 ? 'item' : 'items'}
          {board.pieceId ? ' · linked to a project' : ''}
        </p>
      </div>
    </Link>
  )
}

export function BoardPage({ boardId }: { boardId: string }) {
  const data = useRpc('boards.get', { id: boardId })
  if (data.isError)
    return (
      <>
        <PageHeader crumbs={[{ label: 'Ideas', link: { to: '/ideas' } }, { label: 'Board' }]} />
        <Column>
          {data.error.status === 404 ? (
            <EmptyState title="Board not found" description="It may have been deleted." />
          ) : (
            <InlineError message={data.error.message} onRetry={() => void data.refetch()} />
          )}
        </Column>
      </>
    )
  const board = data.data?.board
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Ideas', link: { to: '/ideas' } }, { label: board?.title ?? '…' }]}
        actions={board && <BoardLink board={board} />}
      />
      <Column wide>
        {board ? (
          <>
            <PageTitle title={board.title} description={board.description || undefined} />
            <DesignBoard board={board} references={data.data!.references} />
          </>
        ) : (
          <Skeleton className="h-96 rounded-lg" />
        )}
      </Column>
    </>
  )
}

/**
 * Where a board in Ideas leads: the project it is linked to (with Unlink), or Start CAD: a new
 * project, blank or from a template, with this board linked or not, or a link to an existing one.
 */
export function BoardLink({ board }: { board: Board }) {
  const navigate = useNavigate()
  const pieces = useRpc('pieces.list', { limit: 50 })
  const linked = pieces.data?.find((p) => p.id === board.pieceId)
  const link = async (pieceId: string | null) => {
    await rpc.call('boards.update', { id: board.id, pieceId })
    invalidateFor(queryClient, 'boards')
  }
  const start = async (opts: { templateId?: string; linkBoard: boolean }) => {
    const piece = await rpc.call('pieces.create', {
      title: board.title.replace(/ · Design$/, ''),
      ...(opts.templateId ? { templateId: opts.templateId } : {}),
    })
    if (opts.linkBoard) await link(piece.id)
    invalidateFor(queryClient, 'pieces')
    await navigate({ to: '/pieces/$id/design', params: { id: piece.id } })
  }
  if (board.pieceId)
    return (
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          icon={Link2}
          onClick={() => void navigate({ to: '/pieces/$id', params: { id: board.pieceId! } })}
        >
          {linked ? `Linked to ${linked.title || 'Untitled'}` : 'Linked to a project'}
        </Button>
        <Button size="sm" variant="ghost" icon={Unlink} onClick={() => void link(null)}>
          Unlink
        </Button>
      </div>
    )
  return (
    <Menu
      align="end"
      trigger={
        <Button size="sm" variant="secondary" icon={Hammer}>
          Start CAD
        </Button>
      }
    >
      <MenuItem
        icon={Hammer}
        description="A new project with this board as its design"
        onClick={() => void start({ linkBoard: true })}
      >
        Blank CAD, board linked
      </MenuItem>
      <MenuItem
        icon={Hammer}
        description="The board stays on its own in Ideas"
        onClick={() => void start({ linkBoard: false })}
      >
        Blank CAD, not linked
      </MenuItem>
      <MenuSub label="From a template, board linked" icon={LayoutTemplate}>
        {TEMPLATES.map((t) => (
          <MenuItem key={t.id} onClick={() => void start({ templateId: t.id, linkBoard: true })}>
            {t.spec.title}
          </MenuItem>
        ))}
      </MenuSub>
      <MenuSeparator />
      <MenuSub label="Link to a project" icon={Link2}>
        {(pieces.data ?? []).slice(0, 20).map((p) => (
          <MenuItem key={p.id} onClick={() => void link(p.id)}>
            {p.title || 'Untitled'}
          </MenuItem>
        ))}
      </MenuSub>
    </Menu>
  )
}
