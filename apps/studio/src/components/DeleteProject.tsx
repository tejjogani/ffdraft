import type { PieceSummary } from '@pave/schema'
import { Button, cn, Dialog, IconButton, InlineError } from '@pave/ui'
import { Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { useDeletePiece } from '../lib/pieces'

type Project = Pick<PieceSummary, 'id' | 'title'>
type FocusTarget = () => HTMLElement | null

export const touchDeleteTarget =
  '[@media(any-pointer:coarse)]:min-h-11 [@media(any-pointer:coarse)]:min-w-11'

export function DeleteProjectButton({
  project,
  onSelect,
}: {
  project: Project
  onSelect: (trigger: HTMLButtonElement) => void
}) {
  return (
    <IconButton
      icon={Trash2}
      label={`Delete project ${project.title || 'Untitled'}`}
      className={cn('bg-bg text-fg-muted shadow-sm hover:text-danger', touchDeleteTarget)}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(event.currentTarget)
      }}
    />
  )
}

export function DeleteProjectDialog({
  project,
  onClose,
  cancelFocus,
  deletedFocus,
  leaveProject = false,
}: {
  project: Project
  onClose: () => void
  cancelFocus: FocusTarget
  deletedFocus?: FocusTarget
  leaveProject?: boolean
}) {
  const remove = useDeletePiece(leaveProject)
  const cancel = useRef<HTMLButtonElement>(null)
  const close = (target?: FocusTarget) => {
    onClose()
    if (target) requestAnimationFrame(() => target()?.focus())
  }
  return (
    <Dialog
      open
      initialFocus={cancel}
      finalFocus={false}
      onOpenChange={(open) => {
        if (!open && !remove.isPending) close(cancelFocus)
      }}
      title={`Delete “${project.title || 'Untitled'}”?`}
      description="This permanently deletes the project, including its CAD, history, renders and packages."
      footer={
        <>
          <Button
            ref={cancel}
            className={touchDeleteTarget}
            disabled={remove.isPending}
            onClick={() => close(cancelFocus)}
          >
            Cancel
          </Button>
          <Button
            className={touchDeleteTarget}
            variant="danger"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate({ id: project.id }, { onSuccess: () => close(deletedFocus) })
            }
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
