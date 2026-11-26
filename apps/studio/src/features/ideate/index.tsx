/** Studio moodboards are reusable boards without a project. */
import type { Board } from '@pave/schema'
import { TEMPLATES } from '@pave/schema'
import {
  Button,
  Dialog,
  EmptyState,
  InlineError,
  Input,
  Menu,
  MenuItem,
  MenuSub,
  Skeleton,
  toast,
} from '@pave/ui'
import { Link, Navigate, useNavigate } from '@tanstack/react-router'
import { Hammer, LayoutTemplate, Plus } from 'lucide-react'
import { useState } from 'react'
import { Column, PageHeader, PageTitle } from '../../components/Page'
import { assetUrl } from '../../lib/assets'
import { invalidateFor, queryClient, useRpc, useRpcMutation } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { useCurrentView } from '../../lib/use-current-view'
import { DesignBoard } from './DesignBoard'

export { DesignBoard } from './DesignBoard'

export function BoardsPage() {
  const boards = useRpc('boards.list', { scope: 'library' })
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  const create = useRpcMutation('boards.create', {
    onMutate: () => isCurrent,
    meta: { silent: true },
    onSuccess: (b, _input, stillHere) => {
      if (stillHere?.()) void navigate({ to: '/moodboards/$boardId', params: { boardId: b.id } })
    },
  })
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Moodboards' }]}
        actions={
          <Dialog
            open={creating}
            onOpenChange={(open) => {
              setCreating(open)
              if (open) {
                setName('')
                create.reset()
              }
            }}
            trigger={
              <Button size="sm" variant="secondary" icon={Plus}>
                New moodboard
              </Button>
            }
            title="New moodboard"
          >
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim() && !create.isPending) create.mutate({ title: name.trim() })
              }}
            >
              <Input
                aria-label="Moodboard name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder="Art Deco"
              />
              {create.error && (
                <p role="alert" className="text-sm text-danger">
                  {create.error.message}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>
                  {create.isPending ? 'Creating…' : 'Create moodboard'}
                </Button>
              </div>
            </form>
          </Dialog>
        }
      />
      <Column wide>
        <PageTitle
          title="Moodboards"
          description="Build a studio library of references you can reuse across projects."
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
            title="No moodboards yet"
            description="Create a moodboard for photos, sketches and ideas you want to use again."
          />
        ) : (
          <ul aria-label="Moodboards" className="grid grid-cols-2 gap-3 md:grid-cols-3">
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
      to="/moodboards/$boardId"
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
        <PageHeader
          crumbs={[{ label: 'Moodboards', link: { to: '/moodboards' } }, { label: 'Board' }]}
        />
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
  if (board?.pinsFor)
    return <Navigate to="/pieces/$id/design" params={{ id: board.pinsFor }} replace />
  if (board?.pieceId)
    return (
      <Navigate
        to="/pieces/$id/directions"
        params={{ id: board.pieceId }}
        search={{ board: board.id }}
        replace
      />
    )
  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Moodboards', link: { to: '/moodboards' } },
          { label: board?.title ?? '…' },
        ]}
        actions={board && <StartBoardCad board={board} />}
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

function StartBoardCad({ board }: { board: Board }) {
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  const [pending, setPending] = useState(false)
  const start = async (templateId?: string) => {
    setPending(true)
    try {
      const piece = await rpc.call('pieces.create', {
        title: board.title,
        ...(templateId ? { templateId } : {}),
      })
      if (board.referenceCount)
        await rpc.call('boards.importMoodboard', { sourceBoardId: board.id, pieceId: piece.id })
      invalidateFor(queryClient, 'pieces')
      invalidateFor(queryClient, 'boards')
      if (isCurrent()) await navigate({ to: '/pieces/$id/design', params: { id: piece.id } })
    } catch (e) {
      toast.error('Couldn’t start CAD', e instanceof Error ? e.message : undefined)
    } finally {
      setPending(false)
    }
  }

  return (
    <Menu
      align="end"
      trigger={
        <Button size="sm" variant="secondary" icon={Hammer} disabled={pending}>
          Start CAD
        </Button>
      }
    >
      <MenuItem
        icon={Hammer}
        description="A new project with a copy of these references"
        onClick={() => void start()}
      >
        Blank CAD
      </MenuItem>
      <MenuSub label="From a template" icon={LayoutTemplate}>
        {TEMPLATES.map((t) => (
          <MenuItem key={t.id} onClick={() => void start(t.id)}>
            {t.spec.title}
          </MenuItem>
        ))}
      </MenuSub>
    </Menu>
  )
}
