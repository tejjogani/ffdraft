/**
 * "✦ Assistant · Added halo; Width at top 2.2 → 1.8 mm — Undo · Review": the assistant's latest
 * run on this piece, as it landed. Undo reverts the whole run on the server (`design.revert
 * {runId}`) — exact even when this window missed part of it — and is one change in History.
 */
import { AiMark, Button, IconButton } from '@pave/ui'
import { X } from 'lucide-react'
import type { RunEdits } from '../../../lib/design-session/core'

export interface ChangeChipProps {
  run: RunEdits
  onUndo(): void
  onReview(): void
  onDismiss(): void
  undoing: boolean
}

export function ChangeChip({ run, onUndo, onReview, onDismiss, undoing }: ChangeChipProps) {
  const summary = [...new Set(run.labels)].join('; ')
  return (
    <div
      role="status"
      className="ai-gradient flex max-w-[min(560px,calc(100%-32px))] rounded-lg p-px shadow-md"
    >
      <div className="glass-pane flex min-w-0 items-center gap-2 rounded-[7px] py-1 pr-1 pl-3 text-sm [background:var(--glass-strong)]">
        <AiMark className="size-3" />
        <span className="shrink-0 font-medium text-fg">Assistant</span>
        <span className="min-w-0 truncate text-fg-muted" title={summary}>
          {summary}
        </span>
        <Button variant="ghost" size="sm" disabled={undoing} onClick={onUndo}>
          Undo
        </Button>
        <Button variant="ghost" size="sm" onClick={onReview}>
          Review
        </Button>
        <IconButton icon={X} label="Dismiss" size="sm" tooltip={false} onClick={onDismiss} />
      </div>
    </div>
  )
}
