import { Button, Dialog, InlineError, Input, Skeleton, toast } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Images } from 'lucide-react'
import { useState } from 'react'
import { useRpc, useRpcMutation } from '../../lib/query'

export function ImportMoodboard({ pieceId, boardId }: { pieceId: string; boardId?: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const library = useRpc('boards.list', { scope: 'library' }, { enabled: open })
  const matches = (library.data ?? []).filter((board) =>
    board.title.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const chosen = matches.find((board) => board.id === selected)
  const importBoard = useRpcMutation('boards.importMoodboard', {
    meta: { silent: true },
    onSuccess: ({ added }) => {
      toast.success(
        added
          ? `${added} ${added === 1 ? 'reference' : 'references'} imported`
          : 'Already in this design',
      )
      setOpen(false)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setQuery('')
          setSelected(null)
          importBoard.reset()
        }
      }}
      trigger={
        <Button size="sm" variant="ghost" icon={Images}>
          Import moodboard
        </Button>
      }
      title="Import moodboard"
      description="Copy references into this design. The assistant can use imported notes and eligible images."
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!chosen?.referenceCount || importBoard.isPending}
            onClick={() => {
              if (chosen)
                importBoard.mutate({
                  sourceBoardId: chosen.id,
                  pieceId,
                  ...(boardId ? { targetBoardId: boardId } : {}),
                })
            }}
          >
            {importBoard.isPending ? 'Importing…' : 'Import references'}
          </Button>
        </>
      }
    >
      <Input
        aria-label="Search moodboards"
        placeholder="Search moodboards"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full"
      />
      {library.isError ? (
        <InlineError
          className="mt-3"
          message={library.error.message}
          onRetry={() => void library.refetch()}
        />
      ) : !library.data ? (
        <Skeleton className="mt-3 h-14" />
      ) : library.data.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">
          Create a board in{' '}
          <Link to="/moodboards" className="underline">
            Moodboards
          </Link>{' '}
          to import it here.
        </p>
      ) : matches.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">No moodboards match these words.</p>
      ) : (
        <ul aria-label="Studio moodboards" className="mt-2 flex flex-col gap-1">
          {matches.map((board) => (
            <li key={board.id}>
              <button
                type="button"
                disabled={!board.referenceCount || importBoard.isPending}
                aria-pressed={selected === board.id}
                className="flex w-full flex-wrap items-center justify-between gap-x-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-bg-hover aria-pressed:bg-bg-active disabled:opacity-50"
                onClick={() => setSelected(board.id)}
              >
                <span className="min-w-0 break-words font-medium">{board.title}</span>
                <span className="text-xs text-fg-muted">
                  {board.referenceCount} {board.referenceCount === 1 ? 'reference' : 'references'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {importBoard.error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {importBoard.error.message}
        </p>
      )}
    </Dialog>
  )
}
