/** Whether this window's edits are on the server: "Saved", "Saving…", "Offline — 3 edits kept". */
import { cn, Spinner } from '@pave/ui'
import { Check, CloudOff } from 'lucide-react'
import type { SaveState } from '../../../lib/design-session/store'
import { plural } from '../../../lib/format'

export function SavePill({ save }: { save: SaveState }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'flex h-7 items-center gap-1.5 px-2 text-xs',
        save.status === 'offline' ? 'text-warn' : 'text-fg-subtle',
      )}
    >
      {save.status === 'saved' && <Check className="size-3.5" aria-hidden />}
      {save.status === 'saving' && <Spinner className="size-3" label="Saving" />}
      {save.status === 'offline' && <CloudOff className="size-3.5" aria-hidden />}
      {save.status === 'saved'
        ? 'Saved'
        : save.status === 'saving'
          ? 'Saving…'
          : `Offline — ${plural(save.count, 'edit')} kept`}
    </span>
  )
}
