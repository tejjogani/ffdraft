/**
 * A call that waits for a person: one plain sentence, the cost when its service can say, the
 * exact input on expand, and Approve or Decline. It never takes focus. Building from the spec
 * shows the spec itself, editable, with Build it as the approval and "Change something…" to
 * decline with a note the assistant reads.
 */

import { machineTime } from '@pave/render'
import type { Piece } from '@pave/schema'
import { AiMark, Button, cn, Textarea } from '@pave/ui'
import { ChevronRight, Hammer } from 'lucide-react'
import { useState } from 'react'
import { SpecCard } from '../../components/SpecCard'
import { usd } from '../../lib/format'
import type { CallItem } from './model'

/** What a call will cost: dollars for a paid service, this computer's time for a render. */
export function EstimateLine({ estimate }: { estimate: NonNullable<CallItem['estimate']> }) {
  return (
    <p className="font-mono text-xs text-fg-muted tabular">
      {estimate.machine
        ? `About ${machineTime(estimate.seconds ?? 0).replace(/^about /, '')} of this computer’s time · nothing is paid`
        : `About ${usd(estimate.usd)}${estimate.seconds ? ` · ${Math.round(estimate.seconds)} s` : ''}`}
    </p>
  )
}

export function ApprovalCard({
  call,
  piece,
  busy,
  onDecide,
}: {
  call: CallItem
  /** The piece, for building from its spec. */
  piece: Piece | null
  busy: boolean
  onDecide: (decision: 'approve' | 'deny', note?: string) => void
}) {
  const [details, setDetails] = useState(false)
  const [changing, setChanging] = useState(false)
  const [note, setNote] = useState('')
  const summary = call.summary ?? `${call.label}.`

  const decline = changing ? (
    <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
      <Textarea
        minRows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What should change first?"
        aria-label="What should change"
      />
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setChanging(false)}>
          Back
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => onDecide('deny', note.trim() || undefined)}
        >
          Send and don’t build
        </Button>
      </div>
    </div>
  ) : null

  if (call.name === 'pieces.buildFromSpec' && piece?.spec)
    return (
      <div className="flex flex-col gap-2" data-approval={call.toolCallId}>
        <p className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <AiMark className="size-3" /> Ready to build from this spec
        </p>
        <SpecCard
          piece={piece}
          variant="inline"
          footer={
            decline ?? (
              <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
                <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
                  Change something…
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={Hammer}
                  disabled={busy}
                  onClick={() => onDecide('approve')}
                >
                  Build it
                </Button>
              </div>
            )
          }
        />
      </div>
    )

  return (
    <div
      data-approval={call.toolCallId}
      className="overflow-hidden rounded-lg bg-bg shadow-[0_0_0_1px_var(--line-strong)]"
    >
      <div className="flex flex-col gap-1 px-4 pt-3 pb-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <AiMark className="size-3" /> Needs your go-ahead
        </p>
        <p className="text-sm">{summary}</p>
        {call.estimate && <EstimateLine estimate={call.estimate} />}
        <button
          type="button"
          aria-expanded={details}
          onClick={() => setDetails((d) => !d)}
          className="inline-flex w-fit items-center gap-1 text-xs text-fg-subtle hover:text-fg-muted"
        >
          <ChevronRight
            className={cn('size-3 transition-transform', details && 'rotate-90')}
            aria-hidden
          />
          Exactly what it will send
        </button>
        {details && (
          <pre className="max-h-48 overflow-auto rounded-md bg-bg-muted p-2 font-mono text-[11px] leading-4">
            {JSON.stringify(call.input, null, 2)}
          </pre>
        )}
      </div>
      {decline ?? (
        <div className="flex justify-end gap-1.5 border-t border-line px-4 py-2.5">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setChanging(true)}>
            Decline
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => onDecide('approve')}>
            Approve
          </Button>
        </div>
      )}
    </div>
  )
}
