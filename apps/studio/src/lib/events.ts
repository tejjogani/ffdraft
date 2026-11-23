import { useEffect } from 'react'
import { invalidateFor, queryClient } from './query'

/** Which query domains each server event refreshes (see `GET /api/events` on the server). */
const EVENT_DOMAINS: Record<string, (data: { kind?: string }) => string[]> = {
  'design.changed': () => ['design'],
  'piece.updated': () => ['pieces'],
  'job.updated': ({ kind }) =>
    kind === 'render'
      ? ['renders']
      : kind === 'shot'
        ? ['shots']
        : kind === 'production'
          ? ['production']
          : [],
}

/**
 * Server-sent change notifications, named by type. Each refreshes the affected queries, so
 * edits made elsewhere — another tab, a teammate, the assistant — appear without a reload.
 * EventSource reconnects on its own after network errors.
 */
export function useServerEvents(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    const source = new EventSource('/api/events', { withCredentials: true })
    for (const [type, domains] of Object.entries(EVENT_DOMAINS)) {
      source.addEventListener(type, (e) => {
        let data: { kind?: string } = {}
        try {
          data = JSON.parse((e as MessageEvent<string>).data)
        } catch {
          // A malformed payload still tells us the domain changed.
        }
        for (const d of domains(data)) invalidateFor(queryClient, d)
      })
    }
    return () => source.close()
  }, [enabled])
}
