/**
 * Live runs as this window sees them: one EventSource per live run, shared by every component
 * that shows it (the dock's conversation, a piece's job panel), folded into a `RunView` by the
 * shared reducer. A stream opens only while its run is live (browsers allow six connections per
 * host over HTTP/1.1, and the window's own event stream holds one) and closes when it ends.
 *
 * Reconnects resume after the last event seen (`?after=<seq>`), so nothing is shown twice; a
 * `run.started` that numbers from 1 again means the server restarted, and the view starts over.
 */
import { initialRunView, type RunView, reduceRun } from '@pave/agent/studio'
import { RUN_EVENT_TYPES, type RunEvent, RunEventSchema } from '@pave/schema'
import { useEffect, useSyncExternalStore } from 'react'
import { invalidateFor, queryClient } from '../../lib/query'

interface Entry {
  view: RunView
  source: EventSource | null
  refs: number
  listeners: Set<() => void>
  retry: ReturnType<typeof setTimeout> | null
  tries: number
}

const entries = new Map<string, Entry>()
/** A run's view outlives its last viewer briefly, so switching panels does not refetch it. */
const KEEP_MS = 60_000

function entry(runId: string): Entry {
  let e = entries.get(runId)
  if (!e) {
    e = {
      view: initialRunView(runId),
      source: null,
      refs: 0,
      listeners: new Set(),
      retry: null,
      tries: 0,
    }
    entries.set(runId, e)
  }
  return e
}

function emit(e: Entry) {
  for (const l of e.listeners) l()
}

/** Applies one event; exported for tests and for events that arrive another way. */
export function applyRunEvent(runId: string, event: RunEvent): RunView {
  const e = entry(runId)
  let view = e.view
  // The server numbers a run's events again from 1 after a restart.
  if (event.type === 'run.started' && event.seq <= view.seq) view = initialRunView(runId)
  const next = reduceRun(view, event)
  if (next !== e.view) {
    e.view = next
    emit(e)
  }
  if (event.type === 'run.finished') {
    close(e)
    // What the run did is now in the stored conversation, the history and the job records.
    for (const domain of ['threads', 'traces', 'design', 'pieces', 'usage'])
      invalidateFor(queryClient, domain)
  }
  return next
}

function close(e: Entry) {
  e.source?.close()
  e.source = null
  if (e.retry) clearTimeout(e.retry)
  e.retry = null
}

function open(runId: string) {
  const e = entry(runId)
  if (e.source || typeof EventSource === 'undefined') return
  const source = new EventSource(`/api/runs/${runId}/events?after=${e.view.seq}`, {
    withCredentials: true,
  })
  e.source = source
  for (const type of RUN_EVENT_TYPES)
    source.addEventListener(type, (m) => {
      e.tries = 0
      let json: unknown
      try {
        json = JSON.parse((m as MessageEvent<string>).data)
      } catch {
        return
      }
      const parsed = RunEventSchema.safeParse(json)
      if (parsed.success) applyRunEvent(runId, parsed.data)
    })
  source.addEventListener('error', () => {
    // The server ends the stream when the run suspends or ends (or answers 204 when it is not
    // live). The browser would reconnect on its own forever; reopen only while someone watches
    // and the run is still said to be live, a little later each time.
    close(e)
    if (e.refs > 0 && !e.view.finished && e.tries < 5) {
      e.tries++
      e.retry = setTimeout(() => {
        e.retry = null
        if (e.refs > 0) open(runId)
      }, 800 * e.tries)
    }
  })
}

function release(runId: string) {
  const e = entries.get(runId)
  if (!e) return
  e.refs = Math.max(0, e.refs - 1)
  if (e.refs > 0) return
  close(e)
  setTimeout(() => {
    if (e.refs === 0 && entries.get(runId) === e) entries.delete(runId)
  }, KEEP_MS)
}

const EMPTY = initialRunView('')

/**
 * The live view of a run, with its stream open while `live` (the run is running). Pass null
 * when there is no run to watch.
 */
export function useRunStream(runId: string | null, live: boolean): RunView | null {
  useEffect(() => {
    if (!runId) return
    const e = entry(runId)
    e.refs++
    if (live) {
      e.tries = 0
      open(runId)
    }
    return () => release(runId)
  }, [runId, live])
  const view = useSyncExternalStore(
    (cb) => {
      if (!runId) return () => {}
      const e = entry(runId)
      e.listeners.add(cb)
      return () => e.listeners.delete(cb)
    },
    () => (runId ? entry(runId).view : EMPTY),
  )
  return runId ? view : null
}
