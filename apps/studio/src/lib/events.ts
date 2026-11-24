/**
 * Server-sent change notifications (`GET /api/events`), parsed against the shared
 * `ServerEventSchema`. One EventSource per window feeds two consumers:
 *
 *  - query invalidation by domain, so edits made elsewhere (another tab, a teammate, the
 *    assistant) appear without a reload;
 *  - typed subscribers (`onServerEvent`), e.g. a live design session that applies
 *    `design.changed` itself instead of refetching the piece.
 *
 * EventSource reconnects on its own after network errors; events sent while it was away are
 * lost, so `onReconnect` subscribers resynchronise.
 */
import {
  SERVER_EVENT_TYPES,
  type ServerEvent,
  ServerEventSchema,
  type ServerEventType,
} from '@pave/schema'
import { useEffect } from 'react'
import { invalidateFor, queryClient, rpcKey } from './query'
import type { QueryName } from './rpc'

type Of<T extends ServerEventType> = Extract<ServerEvent, { type: T }>
type Handler<T extends ServerEventType> = (event: Of<T>) => void
type AnyHandler = (event: ServerEvent) => void

const handlers = new Map<ServerEventType, Set<AnyHandler>>()
const reconnectHandlers = new Set<() => void>()
/** Pieces whose design a live session keeps current itself; their `pieces.get` is not refetched. */
const livePieces = new Set<string>()

/** Subscribes to one event type; returns the unsubscribe function. */
export function onServerEvent<T extends ServerEventType>(type: T, handler: Handler<T>): () => void {
  const set = handlers.get(type) ?? new Set<AnyHandler>()
  handlers.set(type, set)
  // Dispatch only calls a handler with events of its own type.
  const h = handler as unknown as AnyHandler
  set.add(h)
  return () => set.delete(h)
}

/** Called after the stream reconnects: anything sent in between was missed. */
export function onReconnect(handler: () => void): () => void {
  reconnectHandlers.add(handler)
  return () => reconnectHandlers.delete(handler)
}

/** Marks a piece's design as kept live by a session (see `lib/design-session`). */
export function markLive(pieceId: string, live: boolean): void {
  if (live) livePieces.add(pieceId)
  else livePieces.delete(pieceId)
}

/**
 * This window's id on the event stream, so the server can address client-tool requests to it.
 * `getRandomValues`, unlike `randomUUID`, also exists outside secure contexts (a self-hosted
 * studio opened over plain http on a LAN address).
 */
export const clientId = `w${[...crypto.getRandomValues(new Uint8Array(10))]
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('')}`

const invalidate = (names: QueryName[]) => {
  for (const name of names) void queryClient.invalidateQueries({ queryKey: rpcKey(name) })
}

/** What each event refreshes. Domains follow `invalidateFor`; a live design is skipped. */
function refresh(event: ServerEvent): void {
  switch (event.type) {
    case 'design.changed':
      if (livePieces.has(event.pieceId)) invalidate(['design.history', 'pieces.list'])
      else invalidateFor(queryClient, 'design')
      return
    case 'piece.updated':
      invalidateFor(queryClient, 'pieces')
      return
    case 'board.updated':
      invalidateFor(queryClient, 'boards')
      return
    case 'scene.updated':
      invalidateFor(queryClient, 'renders')
      return
    case 'job.updated':
      invalidateFor(
        queryClient,
        event.kind === 'render' ? 'renders' : event.kind === 'shot' ? 'shots' : event.kind,
      )
      return
    case 'run.updated':
      invalidateFor(queryClient, 'threads')
      return
    case 'client.request':
      return
  }
}

function dispatch(raw: string): void {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return
  }
  const parsed = ServerEventSchema.safeParse(json)
  if (!parsed.success) return
  const event = parsed.data
  refresh(event)
  for (const h of handlers.get(event.type) ?? []) h(event)
}

/** Opens the window's event stream while `enabled`. Mount once, in the authenticated shell. */
export function useServerEvents(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    const source = new EventSource(`/api/events?client=${clientId}`, { withCredentials: true })
    for (const type of SERVER_EVENT_TYPES)
      source.addEventListener(type, (e) => dispatch((e as MessageEvent<string>).data))
    let opened = false
    source.addEventListener('ready', () => {
      if (opened) for (const h of reconnectHandlers) h()
      opened = true
    })
    return () => source.close()
  }, [enabled])
}
