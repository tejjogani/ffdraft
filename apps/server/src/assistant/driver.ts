/**
 * Live runs in this process: one AbortController and one event buffer per run, at most one run
 * per thread. The database is the truth (messages, steps, run status); the driver only holds what
 * is in flight, so losing it (a restart) loses nothing a fresh driver cannot rebuild.
 *
 * Run events are numbered per run from 1 (`seq`) and kept in a ring buffer while the run is live
 * and for a short while after, so a studio that reconnects with `?after=<seq>` misses nothing.
 * The counter survives later sessions of the same run in this process (after an approval), so
 * numbers only grow; after a restart they start again with `run.started`, which resets a client.
 */

import type { RunEventBody } from '@pave/agent/anthropic'
import type { RunEvent } from '@pave/schema'

/** Events kept per run; a run's deltas beyond this are dropped from the replay, not the stream. */
const BUFFER = 2000
/** How long a finished run's events stay for late subscribers. */
const RETAIN_MS = 60_000

export type AbortReason = 'cancel' | 'shutdown'

export interface RunListener {
  event(e: RunEvent): void
  /** The session ended (the run finished, suspended for approval, or was stopped). */
  close(): void
}

interface Channel {
  buffer: RunEvent[]
  listeners: Set<RunListener>
  live: boolean
  timer: NodeJS.Timeout | null
}

interface Session {
  threadId: string | null
  controller: AbortController
  /** Set when the run is started again while a session is still running: loop once more. */
  again: boolean
  done: Promise<void>
}

export class Driver {
  readonly #sessions = new Map<string, Session>()
  readonly #channels = new Map<string, Channel>()
  readonly #seq = new Map<string, number>()

  /**
   * Runs `body` for the run unless a session is already live; then that session loops once more
   * (`body` again) when its current pass ends, so a decision that lands while it is still
   * finishing is never missed.
   */
  start(
    runId: string,
    threadId: string | null,
    body: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const live = this.#sessions.get(runId)
    if (live) {
      live.again = true
      return live.done
    }
    const controller = new AbortController()
    const session: Session = { threadId, controller, again: false, done: Promise.resolve() }
    this.#sessions.set(runId, session)
    this.#open(runId)
    session.done = (async () => {
      try {
        do {
          session.again = false
          await body(controller.signal)
        } while (session.again && !controller.signal.aborted)
      } finally {
        this.#sessions.delete(runId)
        this.#close(runId)
      }
    })()
    return session.done
  }

  isLive(runId: string): boolean {
    return this.#sessions.has(runId)
  }

  /** The live run of a thread, if any. */
  liveInThread(threadId: string): string | null {
    for (const [runId, s] of this.#sessions) if (s.threadId === threadId) return runId
    return null
  }

  /** Aborts a live run and resolves once its session has wound down. */
  async abort(runId: string, reason: AbortReason): Promise<void> {
    const s = this.#sessions.get(runId)
    if (!s) return
    s.controller.abort(reason)
    await s.done
  }

  emit(runId: string, body: RunEventBody): RunEvent {
    const seq = (this.#seq.get(runId) ?? 0) + 1
    this.#seq.set(runId, seq)
    const event = { ...body, runId, seq } as RunEvent
    const ch = this.#open(runId)
    ch.buffer.push(event)
    if (ch.buffer.length > BUFFER) ch.buffer.splice(0, ch.buffer.length - BUFFER)
    for (const l of ch.listeners) l.event(event)
    return event
  }

  /**
   * Events after `after`, then live ones through `listener`, or null when the run has no events
   * here (not live in this process and not recently finished).
   */
  subscribe(
    runId: string,
    after: number,
    listener: RunListener,
  ): { backlog: RunEvent[]; live: boolean; unsubscribe: () => void } | null {
    const ch = this.#channels.get(runId)
    if (!ch) return null
    ch.listeners.add(listener)
    return {
      backlog: ch.buffer.filter((e) => e.seq > after),
      live: ch.live,
      unsubscribe: () => ch.listeners.delete(listener),
    }
  }

  /** Aborts every live run (server shutdown) and waits for them to record how they ended. */
  async dispose(): Promise<void> {
    await Promise.allSettled([...this.#sessions.keys()].map((id) => this.abort(id, 'shutdown')))
    for (const ch of this.#channels.values()) if (ch.timer) clearTimeout(ch.timer)
    this.#channels.clear()
  }

  #open(runId: string): Channel {
    let ch = this.#channels.get(runId)
    if (!ch) {
      ch = { buffer: [], listeners: new Set(), live: true, timer: null }
      this.#channels.set(runId, ch)
    }
    if (ch.timer) clearTimeout(ch.timer)
    ch.timer = null
    ch.live = true
    return ch
  }

  #close(runId: string): void {
    const ch = this.#channels.get(runId)
    if (!ch) return
    ch.live = false
    for (const l of ch.listeners) l.close()
    ch.timer = setTimeout(() => {
      if (this.#channels.get(runId) === ch && !ch.live) this.#channels.delete(runId)
    }, RETAIN_MS)
    ch.timer.unref()
  }
}
