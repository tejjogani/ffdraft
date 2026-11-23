import type { Op, StoredChange } from '@pave/schema'
import { AiChip, AiMark, Avatar, Button, EmptyState, InlineError, Skeleton } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Cog, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { dateTime, relativeTime } from '../../lib/format'
import { useRpc, useRpcMutation } from '../../lib/query'

/** The edit history: who changed what, newest first, each change revertible. */
export function PieceHistory({ pieceId }: { pieceId: string }) {
  const history = useRpc('design.history', { pieceId, limit: 100 })
  const members = useRpc('org.members', {})
  const revert = useRpcMutation('design.revert')

  if (history.isError)
    return <InlineError message={history.error.message} onRetry={() => void history.refetch()} />
  if (history.isPending)
    return (
      <div className="flex flex-col gap-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-6 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="mt-2 h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    )
  if (history.data.length === 0)
    return (
      <EmptyState
        title="No changes yet"
        description="Every edit — yours or the assistant’s — will be listed here, and can be undone."
      />
    )

  const userName = (id: string) => members.data?.find((m) => m.user.id === id)?.user

  return (
    <ol className="relative">
      {history.data.map((c, i) => {
        const actor = c.actor
        const user = actor.type === 'user' ? userName(actor.id) : undefined
        return (
          <li key={c.seq} className="group relative flex gap-3 pb-6">
            {i < history.data.length - 1 && (
              <span aria-hidden className="absolute top-7 bottom-0 left-3 w-px bg-line" />
            )}
            <div className="relative z-[1] flex size-6 shrink-0 items-center justify-center">
              {actor.type === 'agent' ? (
                <span className="flex size-6 items-center justify-center rounded-full bg-bg shadow-[0_0_0_1px_var(--line-strong)]">
                  <AiMark className="size-3" />
                </span>
              ) : actor.type === 'user' ? (
                <Avatar
                  name={user?.name ?? 'Someone'}
                  src={user?.image}
                  size="md"
                  className="shadow-[0_0_0_2px_var(--bg)]"
                />
              ) : (
                <span className="flex size-6 items-center justify-center rounded-full bg-bg-muted text-fg-subtle">
                  <Cog className="size-3.5" aria-hidden />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 pt-0.5">
                  <p className="text-sm text-fg">{c.label}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
                    {actor.type === 'agent' ? (
                      <>
                        <AiChip>Assistant</AiChip>
                        <Link
                          to="/settings/traces/$runId"
                          params={{ runId: actor.runId }}
                          className="underline decoration-line-strong underline-offset-2 hover:text-fg"
                        >
                          View run
                        </Link>
                      </>
                    ) : (
                      <span>{actor.type === 'user' ? (user?.name ?? 'Someone') : 'System'}</span>
                    )}
                    <span title={dateTime(c.at)}>{relativeTime(c.at)}</span>
                    <span className="font-mono tabular text-fg-faint">#{c.seq}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RotateCcw}
                  className="hover-reveal"
                  disabled={revert.isPending}
                  onClick={() => revert.mutate({ pieceId, seq: c.seq })}
                >
                  Revert
                </Button>
              </div>
              <OpsDiff change={c} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function OpsDiff({ change }: { change: StoredChange }) {
  const [open, setOpen] = useState(false)
  const ops = change.ops as Op[]
  const inverse = change.inverse as Op[]
  return (
    <div className="mt-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-ml-1 inline-flex h-6 items-center gap-1 rounded-xs px-1 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg"
      >
        <ChevronRight
          className={`size-3 transition-transform duration-120 ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        {ops.length === 1 ? '1 operation' : `${ops.length} operations`}
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-0.5 rounded-md bg-bg-subtle p-2.5 font-mono text-2xs leading-5 shadow-[inset_0_0_0_1px_var(--line)]">
          {ops.flatMap((op, i) =>
            describe(op, inverse).map((line, j) => <DiffLine key={`${i}.${j}`} {...line} />),
          )}
        </ul>
      )}
    </div>
  )
}

function DiffLine({ sign, text }: { sign: '+' | '−' | '~'; text: string }) {
  const tone = sign === '+' ? 'text-ok' : sign === '−' ? 'text-danger' : 'text-fg-subtle'
  return (
    <li className="flex gap-2 text-fg-muted">
      <span className={`w-2 shrink-0 ${tone}`}>{sign}</span>
      <span className="min-w-0 break-words">{text}</span>
    </li>
  )
}

const show = (v: unknown): string => {
  if (v === null || v === undefined) return '∅'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 48 ? `${s.slice(0, 47)}…` : s
}

/** Human lines for an op; updates show before → after using the change's inverse. */
function describe(op: Op, inverse: Op[]): { sign: '+' | '−' | '~'; text: string }[] {
  switch (op.t) {
    case 'add': {
      const n = op.node as { id?: string; kind?: string; name?: string }
      return [{ sign: '+', text: `${n.name ?? n.id ?? 'node'} (${n.kind ?? 'node'})` }]
    }
    case 'remove':
      return [{ sign: '−', text: op.id }]
    case 'move':
      return [{ sign: '~', text: `${op.id} → position ${op.index + 1}` }]
    case 'setKind':
      return [{ sign: '~', text: `kind → ${op.kind}` }]
    case 'update': {
      const before =
        inverse.find((x): x is Extract<Op, { t: 'update' }> => x.t === 'update' && x.id === op.id)
          ?.patch ?? {}
      return Object.entries(op.patch).map(([k, v]) => ({
        sign: '~' as const,
        text: `${op.id}.${k}: ${show(before[k])} → ${show(v)}`,
      }))
    }
  }
}
