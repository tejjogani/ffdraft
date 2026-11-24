/** Whether this window's edits are on the server: "Saved", "Saving…", "Offline — 3 edits kept". */
import { cn, Spinner } from '@pave/ui'
import { Check, CloudOff, Dot } from 'lucide-react'
import type { SaveState } from '../../../lib/design-session/store'
import { plural } from '../../../lib/format'

const TEXT: Record<SaveState['status'], (s: SaveState) => string> = {
  saved: () => 'Saved',
  unsaved: () => 'Editing…',
  saving: () => 'Saving…',
  offline: (s) => `Offline — ${plural('count' in s ? s.count : 0, 'edit')} kept`,
}

/** `compact` keeps only the icon (the text stays the accessible name and tooltip). */
export function SavePill({ save, compact = false }: { save: SaveState; compact?: boolean }) {
  const text = TEXT[save.status](save)
  return (
    <span
      role="status"
      aria-live="polite"
      title={compact ? text : undefined}
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 text-xs whitespace-nowrap',
        compact ? 'px-1.5' : 'px-2',
        save.status === 'offline' ? 'text-warn' : 'text-fg-subtle',
      )}
    >
      {save.status === 'saved' && <Check className="size-3.5" aria-hidden />}
      {save.status === 'unsaved' && <Dot className="size-3.5" aria-hidden />}
      {save.status === 'saving' && <Spinner className="size-3" label="Saving" />}
      {save.status === 'offline' && <CloudOff className="size-3.5" aria-hidden />}
      <span className={cn(compact && 'sr-only')}>{text}</span>
    </span>
  )
}
