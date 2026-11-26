import type { PieceSummary } from '@pave/schema'
import { Button, Dialog, IconButton, InlineError } from '@pave/ui'
import { Trash2 } from 'lucide-react'
import { useDeletePiece } from '../lib/pieces'

type Project = Pick<PieceSummary, 'id' | 'title'>

export function DeleteProjectButton({
  project,
  onSelect,
}: {
  project: Project
  onSelect: () => void
}) {
  return (
    <IconButton
      icon={Trash2}
      label={`Delete project ${project.title || 'Untitled'}`}
      className="bg-bg text-fg-muted shadow-sm hover:text-danger"
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
    />
  )
}

export function DeleteProjectDialog({
  project,
  onClose,
  leaveProject = false,
}: {
  project: Project
  onClose: () => void
  leaveProject?: boolean
}) {
  const remove = useDeletePiece(leaveProject)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose()
      }}
      title={`Delete “${project.title || 'Untitled'}”?`}
      description="This permanently deletes the project, including its CAD, history, renders and packages."
      footer={
        <>
          <Button disabled={remove.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: project.id }, { onSuccess: onClose })}
          >
            {remove.isPending ? 'Deleting…' : 'Delete project'}
          </Button>
        </>
      }
    >
      {remove.error && <InlineError message={remove.error.message} />}
    </Dialog>
  )
}
