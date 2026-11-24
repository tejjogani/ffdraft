/**
 * Live design sessions, one per open piece, shared by every tab and panel that shows it.
 *
 *   const session = useDesignSession(pieceId)          // keeps it alive while mounted
 *   const view = useSessionState(pieceId, (s) => s.view)
 *   session?.commit(ops)                                // one undoable change
 *
 * A session starts from the `pieces.get` cache, applies `design.changed` events itself, writes
 * every confirmed state back into that cache (so other screens read the same design), and keeps
 * a `beforeunload` guard while edits are unsaved. It is disposed shortly after the last user
 * unmounts, so switching tabs does not drop it.
 */
import type { Piece } from '@pave/schema'
import { toast } from '@pave/ui'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { markLive, onReconnect, onServerEvent } from '../events'
import { queryClient, rpcKey } from '../query'
import { RpcError, rpc } from '../rpc'
import { createDesignSession, type DesignSession, type SessionStore } from './session'

export type { DesignSession, SaveState, SessionStore } from './session'

interface Entry {
  session: DesignSession
  refs: number
  release?: ReturnType<typeof setTimeout>
  teardown: () => void
}

const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
const KEEP_ALIVE_MS = 30_000

const transport = {
  apply: (req: Parameters<typeof rpc.call<'design.apply'>>[1]) => rpc.call('design.apply', req),
  history: (pieceId: string, limit: number) => rpc.call('design.history', { pieceId, limit }),
  snapshot: async (id: string) => {
    const piece = await rpc.call('pieces.get', { id })
    queryClient.setQueryData(rpcKey('pieces.get', { id }), piece)
    return piece
  },
}

function open(piece: Piece): Entry {
  const session = createDesignSession(
    piece.id,
    { design: piece.design, version: piece.version },
    {
      transport,
      classify: (e) =>
        e instanceof RpcError && (e.status === 0 || e.status >= 500 || e.status === 429)
          ? 'retry'
          : e instanceof RpcError && e.status === 409
            ? 'conflict'
            : 'reject',
      describe: (e) => (e instanceof Error ? e.message : String(e)),
    },
  )
  const key = rpcKey('pieces.get', { id: piece.id })
  let written = piece.version
  const unsubscribe = session.store.subscribe((s) => {
    for (const n of session.takeNotices())
      if (n.type === 'dropped') toast.error(`“${n.label}” was not applied`, n.reason)
      else toast({ title: 'Nothing to undo', description: `“${n.label}” was changed since.` })
    if (s.version !== written) {
      written = s.version
      queryClient.setQueryData<Piece>(key, (p) =>
        p ? { ...p, design: s.confirmed, version: s.version } : p,
      )
    }
  })
  const offEvent = onServerEvent('design.changed', (e) => session.receive(e.change))
  const offReconnect = onReconnect(() => void session.resync())
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (session.get().pending.length) e.preventDefault()
  }
  window.addEventListener('beforeunload', beforeUnload)
  markLive(piece.id, true)
  return {
    session,
    refs: 0,
    teardown: () => {
      unsubscribe()
      offEvent()
      offReconnect()
      window.removeEventListener('beforeunload', beforeUnload)
      markLive(piece.id, false)
      session.dispose()
    },
  }
}

const notify = () => {
  for (const l of listeners) l()
}

function acquire(piece: Piece): () => void {
  let entry = entries.get(piece.id)
  if (!entry) {
    entry = open(piece)
    entries.set(piece.id, entry)
    notify()
  }
  const e = entry
  clearTimeout(e.release)
  e.refs++
  return () => {
    e.refs--
    if (e.refs > 0) return
    // Unsaved edits keep the session (and its outbox) alive until they are saved.
    const close = () => {
      if (e.refs > 0) return
      if (e.session.get().pending.length) {
        e.release = setTimeout(close, KEEP_ALIVE_MS)
        return
      }
      e.teardown()
      entries.delete(piece.id)
      notify()
    }
    e.release = setTimeout(close, KEEP_ALIVE_MS)
  }
}

/** The live session for a piece, if one is open (any screen may have opened it). */
export function getDesignSession(pieceId: string): DesignSession | null {
  return entries.get(pieceId)?.session ?? null
}

/** Re-renders when sessions open or close. */
export function useLiveSession(pieceId: string): DesignSession | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => getDesignSession(pieceId),
  )
}

/**
 * Opens (or joins) the piece's session for as long as the caller is mounted. Returns null until
 * the piece has loaded.
 */
export function useDesignSession(piece: Piece | undefined): DesignSession | null {
  const id = piece?.id
  const [, rerender] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the session follows the piece id, not each refetch
  useEffect(() => {
    if (!piece) return
    const release = acquire(piece)
    rerender((n) => n + 1)
    return release
  }, [id, !!piece])
  return id ? getDesignSession(id) : null
}

const noop = () => () => {}

/** Selects from a session's state; re-renders only when the selected value changes. */
export function useSessionState<T>(
  session: DesignSession | null,
  select: (s: SessionStore) => T,
): T | undefined {
  return useSyncExternalStore(session ? session.store.subscribe : noop, () =>
    session ? select(session.store.getState()) : undefined,
  )
}
