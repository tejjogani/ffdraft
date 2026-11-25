/**
 * Tool calls in the conversation. An edit is a chip in the past tense with Undo and a link to
 * the piece's history ("Widened the band to 2.4 mm · Undo · History"); reads and looks collapse
 * into one quiet line ("Read the piece · Looked from front, side") whose pictures show on
 * expand. A call that failed says so, with the reason the tool gave.
 */
import type { StoredChange } from '@pave/schema'
import { AiMark, cn, Spinner } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { ChevronRight, CircleAlert, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { assetUrl } from '../../lib/assets'
import type { CallItem } from './model'

export function QuietCalls({ calls }: { calls: CallItem[] }) {
  const [open, setOpen] = useState(false)
  const running = calls.some((c) => c.status === 'running')
  const images = calls.flatMap((c) => c.assetIds)
  const labels = [...new Set(calls.map((c) => c.label))]
  return (
    <div className="text-xs text-fg-subtle">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex max-w-full items-center gap-1.5 rounded-xs py-0.5 text-left hover:text-fg-muted"
      >
        {running ? (
          <Spinner className="size-3" label="Working" />
        ) : (
          <ChevronRight
            aria-hidden
            className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
          />
        )}
        <span className="truncate">{labels.join(' · ')}</span>
      </button>
      {open && (
        <div className="mt-1.5 ml-4.5 flex flex-col gap-1.5">
          {calls.map((c) => (
            <span key={c.toolCallId} className={cn(c.status === 'error' && 'text-danger')}>
              {c.label}
              {c.errorText ? ` — ${c.errorText}` : ''}
            </span>
          ))}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {images.map((id) => (
                <img
                  key={id}
                  src={assetUrl(id, 240)}
                  alt="What the assistant looked at"
                  className="h-20 rounded-md shadow-[0_0_0_1px_var(--line)]"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolChip({
  call,
  pieceId,
  change,
  onUndo,
  undoing,
}: {
  call: CallItem
  pieceId: string | null
  /** The change the call made that can still be undone. */
  change: StoredChange | null
  onUndo: (change: StoredChange) => void
  undoing: boolean
}) {
  const error = call.status === 'error'
  return (
    <div
      className={cn(
        'flex min-h-8 items-start gap-2 rounded-md px-2.5 py-1.5 text-sm shadow-[inset_0_0_0_1px_var(--line)]',
        error && 'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_35%,transparent)]',
      )}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {call.status === 'running' || call.status === 'waiting' ? (
          <Spinner className="size-3.5" label="Working" />
        ) : error ? (
          <CircleAlert className="size-3.5 text-danger" aria-hidden />
        ) : (
          <AiMark className="size-3" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block', error && 'text-fg-muted')}>
          {error
            ? `Couldn’t finish: ${call.label.charAt(0).toLowerCase()}${call.label.slice(1)}`
            : call.label}
          {(call.status === 'running' || call.status === 'waiting') && '…'}
        </span>
        {error && call.errorText && (
          <span className="mt-0.5 line-clamp-3 block text-xs text-fg-subtle">{call.errorText}</span>
        )}
      </span>
      {!error && call.status === 'done' && (change || pieceId) && (
        <span className="flex shrink-0 items-center gap-0.5 text-xs">
          {change && (
            <button
              type="button"
              disabled={undoing}
              onClick={() => onUndo(change)}
              className="inline-flex h-6 items-center gap-1 rounded-xs px-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-50"
            >
              <Undo2 className="size-3" aria-hidden />
              Undo
            </button>
          )}
          {change && pieceId && (
            <Link
              to="/pieces/$id/history"
              params={{ id: pieceId }}
              className="inline-flex h-6 items-center rounded-xs px-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
            >
              History
            </Link>
          )}
        </span>
      )}
    </div>
  )
}
