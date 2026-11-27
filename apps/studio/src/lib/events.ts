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

import type { Piece, RenderJob } from '@pave/schema'
import {
  SERVER_EVENT_TYPES,
  type ServerEvent,
  ServerEventSchema,
  type ServerEventType,
} from '@pave/schema'
import { useEffect } from 'react'
import { patchPiece } from './piece-cache'
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
    case 'design.changed': {
      // Saved shots derive their implicit imported preview settings from the current design.
      void queryClient.invalidateQueries({
        queryKey: rpcKey('scenes.list', { pieceId: event.pieceId }),
      })
      if (livePieces.has(event.pieceId)) {
        invalidate(['design.history', 'pieces.list', 'renders.list'])
        return
      }
      // Patch the cached piece when the change is its next version; otherwise refetch it.
      const key = rpcKey('pieces.get', { id: event.pieceId })
      const cached = queryClient.getQueryData<Piece>(key)
      const patched = cached ? patchPiece(cached, event) : 'refetch'
      if (patched === 'refetch') invalidateFor(queryClient, 'design')
      else {
        if (patched !== 'unchanged') queryClient.setQueryData(key, patched)
        invalidate(['design.history', 'design.evaluate', 'pieces.list', 'renders.list'])
      }
      return
    }
    case 'piece.updated':
      invalidateFor(queryClient, 'pieces')
      return
    case 'board.updated':
      invalidateFor(queryClient, 'boards')
      return
    case 'scene.updated':
      invalidateFor(queryClient, 'renders')
      return
    case 'render.installRequested':
      invalidate(['renders.installStatus'])
      return
    case 'job.updated':
      // A take's progress ticks every second: patch the ring in place rather than refetch.
      if (event.kind === 'render' && event.status === 'running' && patchTake(event)) return
      invalidateFor(
        queryClient,
        event.kind === 'render' ? 'renders' : event.kind === 'shot' ? 'shots' : event.kind,
      )
      return
    case 'run.updated':
      invalidateFor(queryClient, 'threads')
      invalidateFor(queryClient, 'traces')
      return
    case 'client.request':
      return
  }
}

/**
 * Writes a running take's progress into every cached list and record that holds it. False when
 * no cache holds it yet (or it just started running), so the caller refetches instead.
 */
function patchTake(e: Extract<ServerEvent, { type: 'job.updated' }>): boolean {
  let found = false
  const patch = (j: RenderJob): RenderJob => {
    if (j.id !== e.id) return j
    if (j.status === 'running') found = true
    return j.status === 'running' ? { ...j, progress: e.progress } : j
  }
  queryClient.setQueriesData<RenderJob[]>({ queryKey: rpcKey('renders.list') }, (list) =>
    list?.map(patch),
  )
  queryClient.setQueriesData<RenderJob>({ queryKey: rpcKey('renders.get') }, (job) =>
    job ? patch(job) : job,
  )
  return found
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
