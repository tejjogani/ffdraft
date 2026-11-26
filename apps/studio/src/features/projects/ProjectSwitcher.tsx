import { Button, Dialog, InlineError, Input } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { ArrowLeftRight, Check } from 'lucide-react'
import { useState } from 'react'
import { useRpc } from '../../lib/query'
import { PROJECT_MENU, type ProjectArea } from './areas'
import { projectFolder } from './folder'

/** Switching keeps the area. The target owns its own boards, shots and selection. */
export function ProjectSwitcher({ pieceId, area }: { pieceId: string; area?: ProjectArea }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const projects = useRpc('pieces.list', { q: query.trim(), limit: 200 }, { enabled: open })
  const folders = useRpc('collections.list', {}, { enabled: open })
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
      title="Switch project"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          icon={ArrowLeftRight}
          aria-label="Switch project"
          className="max-sm:px-1.5"
        >
          <span className="max-sm:hidden">Switch project</span>
        </Button>
      }
    >
      <Input
        aria-label="Search projects"
        placeholder="Search projects"
        value={query}
        maxLength={200}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="mt-3 flex max-h-[50vh] flex-col overflow-y-auto">
        {projects.isPending && (
          <p role="status" className="p-2 text-sm text-fg-muted">
            Loading projects…
          </p>
        )}
        {projects.isError && (
          <InlineError message={projects.error.message} onRetry={() => void projects.refetch()} />
        )}
        {projects.data?.length === 0 && (
          <p className="p-2 text-sm text-fg-muted">No matching projects.</p>
        )}
        {projects.data?.map((p) => (
          <Link
            key={p.id}
            to={area?.to ?? PROJECT_MENU}
            params={{ id: p.id }}
            search={{}}
            aria-current={p.id === pieceId ? 'true' : undefined}
            onClick={() => setOpen(false)}
            className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm hover:bg-bg-hover"
          >
            <span className="min-w-0">
              <span className="block truncate">{p.title || 'Untitled'}</span>
              <span className="block truncate text-xs text-fg-muted">
                {projectFolder(p.collectionId, folders.data)}
              </span>
            </span>
            {p.id === pieceId && <Check aria-hidden className="size-4 shrink-0" />}
          </Link>
        ))}
      </div>
    </Dialog>
  )
}
