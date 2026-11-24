/**
 * A live design session: the pure state machine in ./core plus the outbox that sends pending
 * changes to the server, one at a time, and the catch-up path for missed events. I/O goes
 * through an injected transport so the whole sync loop can be tested against a fake server.
 */
import type { Design, Op, StoredChange } from '@pave/schema'
import { createStore, type StoreApi } from 'zustand/vanilla'
import * as core from './core'

export interface ApplyRequest {
  pieceId: string
  changeId: string
  label: string
  ops: Op[]
  reverts?: string[]
}

export interface SessionTransport {
  apply(req: ApplyRequest): Promise<{ version: number; change: StoredChange }>
  /** Newest first, at most `limit`. */
  history(pieceId: string, limit: number): Promise<StoredChange[]>
  snapshot(pieceId: string): Promise<{ design: Design; version: number }>
}

/** How a failed request should be handled. */
export type Failure = 'retry' | 'conflict' | 'reject'

export interface SessionDeps {
  transport: SessionTransport
  /** Classifies an error from `transport.apply`. */
  classify(error: unknown): Failure
  /** Message for a refused change. */
  describe(error: unknown): string
  /** Delay before retrying an unreachable server, by attempt (ms). */
  backoff?: (attempt: number) => number
  /** How long a gap may stay open before history is fetched (ms). */
  gapWait?: number
}

export type SaveState =
  | { status: 'saved' }
  /** A live gesture (a scrub, typing) that is not a change yet. */
  | { status: 'unsaved' }
  | { status: 'saving'; count: number }
  | { status: 'offline'; count: number }

export interface SessionStore extends core.SessionState {
  save: SaveState
}

const HISTORY_LIMIT = 200

export interface DesignSession {
  readonly store: StoreApi<SessionStore>
  get(): SessionStore
  commit(ops: readonly Op[], opts?: core.CommitOptions): void
  preview(key: string, ops: readonly Op[]): void
  commitGesture(): void
  cancelGesture(): void
  undo(): void
  redo(): void
  /** Ingests a server change from any source (ack, event, history). */
  receive(change: StoredChange): void
  /** Fetches what this window may have missed (after a reconnect, or a lasting gap). */
  resync(): Promise<void>
  /** Resolves once nothing is pending and no gesture is live. */
  idle(): Promise<void>
  takeNotices(): core.Notice[]
  dispose(): void
}

export function createDesignSession(
  pieceId: string,
  initial: { design: Design; version: number },
  deps: SessionDeps,
): DesignSession {
  const backoff = deps.backoff ?? ((n) => Math.min(30_000, 500 * 2 ** n))
  const gapWait = deps.gapWait ?? 1500
  const store = createStore<SessionStore>(() => ({
    ...core.createSession(pieceId, initial.design, initial.version),
    save: { status: 'saved' },
  }))
  let disposed = false
  let inflight: string | null = null
  let offlineAttempts = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let gapTimer: ReturnType<typeof setTimeout> | undefined
  let gapAttempts = 0
  let syncing: Promise<void> | null = null
  const idleWaiters = new Set<() => void>()
  /** Changes that already met a conflict once. */
  const conflicted = new Set<string>()

  const saveState = (s: core.SessionState): SaveState => {
    const count = s.pending.length
    if (count === 0) return s.gesture ? { status: 'unsaved' } : { status: 'saved' }
    return offlineAttempts > 0 ? { status: 'offline', count } : { status: 'saving', count }
  }

  const set = (next: core.SessionState) => {
    if (disposed) return
    store.setState({ ...next, save: saveState(next) }, true)
    if (next.pending.length === 0 && !next.gesture) for (const w of idleWaiters) w()
    if (core.hasGap(next)) scheduleGapCheck()
    pump()
  }
  const update = (f: (s: core.SessionState) => core.SessionState) => set(f(store.getState()))

  function scheduleGapCheck(delay = gapWait) {
    if (gapTimer || disposed) return
    gapTimer = setTimeout(() => {
      gapTimer = undefined
      if (core.hasGap(store.getState())) void resync()
    }, delay)
  }

  async function resync(): Promise<void> {
    syncing ??= (async () => {
      try {
        const changes = await deps.transport.history(pieceId, HISTORY_LIMIT)
        const { version } = store.getState()
        const oldest = changes.at(-1)?.seq ?? Number.POSITIVE_INFINITY
        // The page must reach back to the change after ours, or something in between is unknown.
        if (changes.length === HISTORY_LIMIT && oldest > version + 1) {
          const snap = await deps.transport.snapshot(pieceId)
          update((s) => core.rebase(s, snap.design, snap.version))
        } else update((s) => core.catchUp(s, changes))
        gapAttempts = 0
      } catch {
        // Unreachable. A gap blocks the outbox (its ack may be waiting behind it), so keep
        // trying with backoff rather than waiting for an event that may never come.
        if (core.hasGap(store.getState())) scheduleGapCheck(backoff(gapAttempts++))
      }
    })().finally(() => {
      syncing = null
      pump()
    })
    return syncing
  }

  function pump() {
    if (disposed || inflight || retryTimer || syncing) return
    const next = core.nextToSend(store.getState())
    if (!next) return
    inflight = next.id
    store.setState(core.markSent(store.getState(), next.id))
    deps.transport
      .apply({
        pieceId,
        changeId: next.id,
        label: next.label,
        ops: next.ops,
        ...(next.reverts ? { reverts: next.reverts } : {}),
      })
      .then(
        ({ change }) => {
          inflight = null
          offlineAttempts = 0
          update((s) => core.receive(s, change))
        },
        async (error: unknown) => {
          inflight = null
          const kind = deps.classify(error)
          if (kind === 'retry') {
            offlineAttempts++
            // The timer must exist before `update` re-enters `pump`, or that would resend now.
            clearTimeout(retryTimer)
            retryTimer = setTimeout(
              () => {
                retryTimer = undefined
                pump()
              },
              backoff(offlineAttempts - 1),
            )
            update((s) => s)
            return
          }
          offlineAttempts = 0
          if (kind === 'conflict' && !conflicted.has(next.id)) {
            // Catch up, then send it once more on top of the latest state (resync pumps when
            // done); a second conflict is final.
            conflicted.add(next.id)
            await resync()
            return
          }
          update((s) => core.reject(s, next.id, deps.describe(error)))
        },
      )
  }
  const act = (f: (s: core.SessionState) => core.SessionState) => () => update(f)
  // The starting snapshot may be older than the server (a cached copy): catch up once.
  void resync()

  return {
    store,
    get: () => store.getState(),
    commit: (ops, opts) => update((s) => core.commit(s, ops, opts)),
    preview: (key, ops) => update((s) => core.preview(s, key, ops)),
    commitGesture: act(core.commitGesture),
    cancelGesture: act(core.cancelGesture),
    undo: act(core.undo),
    redo: act(core.redo),
    receive: (change) => {
      if (change.pieceId === pieceId) update((s) => core.receive(s, change))
    },
    resync,
    idle: () => {
      const s = store.getState()
      if (s.pending.length === 0 && !s.gesture) return Promise.resolve()
      return new Promise((resolve) => {
        const done = () => {
          idleWaiters.delete(done)
          resolve()
        }
        idleWaiters.add(done)
      })
    },
    takeNotices: () => {
      const { notices } = store.getState()
      if (notices.length) store.setState(core.clearNotices(store.getState()))
      return notices
    },
    dispose: () => {
      disposed = true
      clearTimeout(retryTimer)
      clearTimeout(gapTimer)
      for (const w of idleWaiters) w()
    },
  }
}
