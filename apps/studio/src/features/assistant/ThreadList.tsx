/** Your conversations, newest first; one opens in the dock. */
import { cn, Skeleton } from '@pave/ui'
import { MessageSquare } from 'lucide-react'
import { relativeTime } from '../../lib/format'
import { useRpc } from '../../lib/query'
import { useAssistant } from '../../stores/assistant'

export function ThreadList() {
  const threads = useRpc('threads.list', { limit: 50 })
  const active = useAssistant((s) => s.activeThreadId)
  const openThread = useAssistant((s) => s.openThread)
  if (threads.isPending)
    return (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    )
  if (!threads.data?.length)
    return <p className="p-6 text-center text-sm text-fg-muted">No conversations yet.</p>
  return (
    <ul aria-label="Conversations" className="flex flex-col gap-px overflow-y-auto p-2">
      {threads.data.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => openThread(t.id)}
            aria-current={t.id === active ? 'true' : undefined}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-bg-hover',
              t.id === active && 'bg-bg-active',
            )}
          >
            <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{t.title}</span>
              <span className="block text-xs text-fg-subtle">{relativeTime(t.updatedAt)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
