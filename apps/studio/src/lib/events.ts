import { useEffect } from 'react'
import { invalidateFor, queryClient } from './query'

/**
 * Server-sent change notifications. Each message is JSON with a `type` named after the command
 * or domain that changed (e.g. `"design.apply"`, `"renders"`); we refresh that domain's queries.
 * EventSource reconnects on its own after network errors.
 */
export function useServerEvents(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    const source = new EventSource('/api/events', { withCredentials: true })
    source.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type?: unknown }
        if (typeof msg.type === 'string') invalidateFor(queryClient, msg.type)
      } catch {
        // Keep-alives and non-JSON comments carry nothing to refresh.
      }
    }
    return () => source.close()
  }, [enabled])
}
