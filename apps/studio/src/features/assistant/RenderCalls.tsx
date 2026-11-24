/**
 * Renders in the conversation. A `renders.create` call shows its take where it was asked for:
 * the progress ring while it renders (with Cancel), then the picture, linked to the Render tab.
 * Several renders asked for in one turn (a set, or variants "in rose gold and platinum") are
 * one go-ahead: one card, one Approve, the total machine time.
 */
import { machineTime } from '@pave/render'
import type { RenderJob } from '@pave/schema'
import { AiMark, Button, Chip, Textarea, toast } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { assetUrl } from '../../lib/assets'
import { useRpc, useRpcMutation } from '../../lib/query'
import { isLive, takeLabel } from '../render/shots'
import { TakeProgress } from '../render/TakeProgress'
import type { CallItem } from './model'

/** The take a call made: the run's agent actor names the call. */
export function takeOfCall(takes: readonly RenderJob[] | undefined, call: CallItem) {
  return takes?.find(
    (t) =>
      t.actor.type === 'agent' &&
      t.actor.toolCallId === call.toolCallId &&
      (call.runId === null || t.actor.runId === call.runId),
  )
}

export function TakeCard({ call, pieceId }: { call: CallItem; pieceId: string }) {
  const takes = useRpc('renders.list', { pieceId, limit: 200 })
  const cancel = useRpcMutation('renders.cancel', { meta: { silent: true } })
  const take = takeOfCall(takes.data, call)
  if (!take) return null
  const image = take.assetIds[0]
  return (
    <div className="ml-6 max-w-[300px] overflow-hidden rounded-lg bg-bg shadow-[0_0_0_1px_var(--line)]">
      {take.status === 'done' && image ? (
        <Link to="/pieces/$id/render" params={{ id: pieceId }} className="block">
          <img
            src={assetUrl(image, 640)}
            alt={`Take: ${takeLabel(take)}`}
            className="aspect-square w-full bg-bg-muted object-cover"
          />
        </Link>
      ) : isLive(take) ? (
        <div className="p-3">
          <TakeProgress
            take={take}
            estimate={call.estimate?.seconds ?? null}
            canceling={cancel.isPending}
            onCancel={() =>
              cancel.mutate(
                { id: take.id },
                { onError: (e) => toast.error('Couldn’t cancel', e.message) },
              )
            }
          />
        </div>
      ) : (
        <p className="p-3 text-xs text-fg-muted">
          {take.status === 'canceled' ? 'Canceled.' : (take.error ?? 'The render failed.')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 text-xs text-fg-muted">
        <span className="min-w-0 flex-1 truncate">{takeLabel(take)}</span>
        {take.engine === 'browser' && <Chip>Preview quality</Chip>}
        {take.stale && <Chip tone="warn">Design changed</Chip>}
        {take.seconds !== null && take.status === 'done' && (
          <span className="font-mono tabular">{Math.round(take.seconds)} s</span>
        )}
      </div>
    </div>
  )
}

/** One go-ahead for every render a turn asked for. */
export function RenderBatchApproval({
  calls,
  busy,
  onDecide,
}: {
  calls: CallItem[]
  busy: boolean
  onDecide: (decision: 'approve' | 'deny', note?: string) => void
}) {
  const [changing, setChanging] = useState(false)
  const [note, setNote] = useState('')
  const seconds = calls.reduce((sum, c) => sum + (c.estimate?.seconds ?? 0), 0)
  const names = calls.map((c) => {
    const i = c.input as { variantLabel?: string; title?: string }
    return i.variantLabel ?? i.title ?? 'a take'
  })
  return (
    <div
      data-approval={calls.map((c) => c.toolCallId).join(' ')}
      className="overflow-hidden rounded-lg bg-bg shadow-[0_0_0_1px_var(--line-strong)]"
    >
      <div className="flex flex-col gap-1 px-4 pt-3 pb-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <AiMark className="size-3" /> Needs your go-ahead
        </p>
        <p className="text-sm">
          Render {calls.length} takes: {names.join(', ')}. They use this computer; nothing is paid.
        </p>
        {seconds > 0 && (
          <p className="font-mono text-xs text-fg-muted tabular">
            About {machineTime(seconds).replace(/^about /, '')} of this computer’s time in all
          </p>
        )}
      </div>
      {changing ? (
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
              Send and don’t render
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-1.5 border-t border-line px-4 py-2.5">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setChanging(true)}>
            Decline
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => onDecide('approve')}>
            Render {calls.length} takes
          </Button>
        </div>
      )}
    </div>
  )
}
