/**
 * The design session as a pure state machine: what one window believes a piece's design is,
 * and how its own edits reach the server's log without ever losing someone else's.
 *
 *   confirmed ──(+ pending, in order)──▶ settled ──(+ live gesture)──▶ view
 *
 *  - `confirmed` is the server's design at `version`. It only ever advances by applying the
 *    server's own changes in `seq` order (acks and `design.changed` events alike), so it is
 *    always exactly a server state.
 *  - `pending` are this window's changes not yet acknowledged, sent one at a time, each with a
 *    client-chosen id so a retry is idempotent. Whenever `confirmed` moves they are re-applied
 *    on top; one that no longer applies (someone deleted its node) is dropped with a notice.
 *  - a `gesture` (a scrub, a drag) previews ops without recording anything; committing it makes
 *    one pending change, squashed and labelled from the schema ("Width at top 2.2 → 2.6 mm").
 *  - undo applies the server's inverse of one of our changes as a new change that `reverts` it,
 *    restricted to the values that change wrote and nobody has changed since — so undo never
 *    clobbers an assistant edit made in between.
 *
 * Every function returns a new state; nothing here performs I/O.
 */
import {
  applyOps,
  type Design,
  labelForOps,
  mergePatch,
  newId,
  type Op,
  OpError,
  squashOps,
  type StoredChange,
} from '@pave/schema'

export interface PendingChange {
  /** Client-chosen change id; the server stores the change under it. */
  id: string
  ops: Op[]
  label: string
  /** Ids of earlier changes this one undoes (undo / redo). */
  reverts?: string[]
  /** Whether the outbox has sent it (it may be retried under the same id). */
  sent: boolean
}

export interface Gesture {
  /** What is being scrubbed, e.g. `ringShank_1.widthTop`; a preview under another key commits this one. */
  key: string
  ops: Op[]
}

/** A change this window made, kept so it can be undone exactly. */
interface OwnChange {
  ops: Op[]
  /** The server's inverse once acknowledged; until then the local one. */
  inverse: Op[]
  label: string
}

/** An assistant run's edits as this window saw them arrive, for the change chip and spark dots. */
export interface RunEdits {
  runId: string
  changeIds: string[]
  labels: string[]
  /** Value of each touched top-level field before the run's first change to it: `prior[nodeId][key]`. */
  prior: Record<string, Record<string, unknown>>
  /** Nodes the run added. */
  added: string[]
  at: string
}

export type Notice =
  | { type: 'dropped'; label: string; reason: string }
  | { type: 'nothing-to-undo'; label: string }

export interface SessionState {
  pieceId: string
  confirmed: Design
  version: number
  pending: PendingChange[]
  gesture: Gesture | null
  /** Server changes that arrived ahead of a gap, by seq. */
  inbox: Record<number, StoredChange>
  /** Own change ids, most recent last. */
  undo: string[]
  redo: string[]
  own: Record<string, OwnChange>
  /** Recent assistant runs, newest last. */
  runs: RunEdits[]
  notices: Notice[]
  /** confirmed + pending. */
  settled: Design
  /** settled + gesture: what the window shows. */
  view: Design
}

const MAX_RUNS = 5
const MAX_UNDO = 200

export function createSession(pieceId: string, design: Design, version: number): SessionState {
  return {
    pieceId,
    confirmed: design,
    version,
    pending: [],
    gesture: null,
    inbox: {},
    undo: [],
    redo: [],
    own: {},
    runs: [],
    notices: [],
    settled: design,
    view: design,
  }
}

// ── Derivation ───────────────────────────────────────────────────────────────────────────────

/** Re-applies pending changes and the gesture over `confirmed`, dropping what no longer applies. */
function derive(s: SessionState): SessionState {
  let settled = s.confirmed
  const pending: PendingChange[] = []
  const notices = [...s.notices]
  const own = { ...s.own }
  let undo = s.undo
  for (const p of s.pending) {
    try {
      settled = applyOps(settled, p.ops).design
      pending.push(p)
    } catch (err) {
      if (!(err instanceof OpError)) throw err
      // A change already sent may be committed: keep it until the server says otherwise.
      if (p.sent) {
        pending.push(p)
        continue
      }
      notices.push({ type: 'dropped', label: p.label, reason: err.message })
      delete own[p.id]
      undo = undo.filter((id) => id !== p.id)
    }
  }
  let view = settled
  let gesture = s.gesture
  if (gesture) {
    try {
      view = applyOps(settled, gesture.ops).design
    } catch (err) {
      if (!(err instanceof OpError)) throw err
      gesture = null
    }
  }
  return { ...s, pending, notices, own, undo, settled, view, gesture }
}

// ── Local edits ──────────────────────────────────────────────────────────────────────────────

export interface CommitOptions {
  label?: string
  reverts?: string[]
  /** Change id; generated when omitted. */
  id?: string
}

/**
 * Records `ops` as one change on top of what the window shows (committing any live gesture
 * first). Ops that do not apply are refused with an OpError; ops that change nothing are ignored.
 */
export function commit(s: SessionState, ops: readonly Op[], opts: CommitOptions = {}): SessionState {
  const base = s.gesture ? commitGesture(s) : s
  return record(base, squashOps(ops), opts, 'edit')
}

function record(
  s: SessionState,
  ops: Op[],
  opts: CommitOptions,
  kind: 'edit' | 'undo' | 'redo',
): SessionState {
  if (ops.length === 0) return s
  const label = opts.label ?? labelForOps(ops, s.settled)
  if (label === 'No change' && !opts.label) return s
  const { inverse } = applyOps(s.settled, ops)
  const id = opts.id ?? newId('chg')
  const change: PendingChange = {
    id,
    ops,
    label,
    sent: false,
    ...(opts.reverts ? { reverts: opts.reverts } : {}),
  }
  const next: SessionState = {
    ...s,
    pending: [...s.pending, change],
    own: { ...s.own, [id]: { ops, inverse, label } },
    undo: kind === 'undo' ? s.undo : [...s.undo, id].slice(-MAX_UNDO),
    redo: kind === 'edit' ? [] : kind === 'undo' ? [...s.redo, id] : s.redo,
  }
  return derive(next)
}

/** Shows `ops` live without recording them. A preview under another key commits the previous gesture. */
export function preview(s: SessionState, key: string, ops: readonly Op[]): SessionState {
  const base = s.gesture && s.gesture.key !== key ? commitGesture(s) : s
  try {
    const view = applyOps(base.settled, ops).design
    return { ...base, gesture: { key, ops: [...ops] }, view }
  } catch (err) {
    // An out-of-range value mid-scrub: keep showing the last valid preview.
    if (err instanceof OpError) return base
    throw err
  }
}

/** Ends the gesture as one labelled change ("Width at top 2.2 → 2.6 mm"), or nothing if it returned to the start. */
export function commitGesture(s: SessionState, opts: CommitOptions = {}): SessionState {
  if (!s.gesture) return s
  const ops = squashOps(s.gesture.ops)
  const cleared: SessionState = { ...s, gesture: null, view: s.settled }
  return record(cleared, ops, opts, 'edit')
}

export function cancelGesture(s: SessionState): SessionState {
  return s.gesture ? { ...s, gesture: null, view: s.settled } : s
}

// ── Undo ─────────────────────────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * The part of an inverse patch whose values the forward patch wrote and nobody has changed
 * since. A variant object (one with `type`) is restored whole or not at all, since half of one
 * variant and half of another is not a valid node.
 */
function guardPatch(
  inverse: Record<string, unknown>,
  forward: Record<string, unknown>,
  current: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const cur = isObject(current) ? current : {}
  for (const [k, before] of Object.entries(inverse)) {
    const wrote = forward[k]
    const now = cur[k]
    if (isObject(before) && isObject(wrote) && !('type' in wrote)) {
      const sub = guardPatch(before, wrote, now)
      if (Object.keys(sub).length) out[k] = sub
    } else if (equal(now, wrote === null ? undefined : mergePatch(undefined, wrote))) {
      out[k] = before
    } else if (isObject(wrote) && isObject(now) && equal(mergePatch(cur[k], wrote), now)) {
      // A variant still exactly as written (merge-patch over its previous value).
      out[k] = before
    }
  }
  return out
}

/**
 * The ops that undo `change` against `current` without touching anything changed after it:
 * updates keep only still-unchanged values, removals of nodes it added only if they still
 * exist, re-adds of nodes it removed only if they are still gone.
 */
export function guardedInverse(change: { ops: Op[]; inverse: Op[] }, current: Design): Op[] {
  const forward = new Map<string, Record<string, unknown>>()
  for (const op of squashOps(change.ops))
    if (op.t === 'update') forward.set(op.id, mergePatch(forward.get(op.id), op.patch) as never)
  const out: Op[] = []
  for (const op of change.inverse) {
    switch (op.t) {
      case 'update': {
        const node = current.nodes[op.id]
        if (!node) break
        const patch = guardPatch(op.patch, forward.get(op.id) ?? {}, node)
        if (Object.keys(patch).length) out.push({ t: 'update', id: op.id, patch })
        break
      }
      case 'remove':
        if (current.nodes[op.id]) out.push(op)
        break
      case 'add': {
        const id = (op.node as { id: string }).id
        if (!current.nodes[id]) out.push(op)
        break
      }
      default:
        out.push(op)
    }
  }
  return out
}

function revertOwn(s: SessionState, id: string, kind: 'undo' | 'redo'): SessionState {
  const change = s.own[id]
  if (!change) return s
  const ops = guardedInverse(change, s.settled)
  const label = kind === 'undo' ? `Undo ${change.label}` : `Redo ${change.label.replace(/^Undo /, '')}`
  if (ops.length === 0) return { ...s, notices: [...s.notices, { type: 'nothing-to-undo', label: change.label }] }
  try {
    return record(s, ops, { label: label.slice(0, 200), reverts: [id] }, kind)
  } catch (err) {
    if (!(err instanceof OpError)) throw err
    return { ...s, notices: [...s.notices, { type: 'dropped', label, reason: err.message }] }
  }
}

export const canUndo = (s: SessionState): boolean => s.undo.length > 0 || s.gesture !== null
export const canRedo = (s: SessionState): boolean => s.redo.length > 0

export function undo(s: SessionState): SessionState {
  if (s.gesture) return cancelGesture(s)
  const id = s.undo.at(-1)
  if (!id) return s
  return revertOwn({ ...s, undo: s.undo.slice(0, -1) }, id, 'undo')
}

export function redo(s: SessionState): SessionState {
  const id = s.redo.at(-1)
  if (!id) return s
  return revertOwn({ ...s, redo: s.redo.slice(0, -1) }, id, 'redo')
}

// ── Sync ─────────────────────────────────────────────────────────────────────────────────────

/** The change the outbox should send next, if any (one in flight at a time). */
export function nextToSend(s: SessionState): PendingChange | null {
  const next = s.pending[0]
  // Already committed, waiting behind a gap: resending would only replay it.
  if (!next || Object.values(s.inbox).some((c) => c.id === next.id)) return null
  return next
}

export function markSent(s: SessionState, id: string): SessionState {
  return { ...s, pending: s.pending.map((p) => (p.id === id ? { ...p, sent: true } : p)) }
}

function trackRun(runs: RunEdits[], change: StoredChange, before: Design): RunEdits[] {
  if (change.actor.type !== 'agent') return runs
  const runId = change.actor.runId
  const current = runs.find((r) => r.runId === runId)
  const run: RunEdits = current
    ? { ...current, prior: { ...current.prior } }
    : { runId, changeIds: [], labels: [], prior: {}, added: [], at: change.at }
  run.changeIds = [...run.changeIds, change.id]
  run.labels = [...run.labels, change.label]
  run.at = change.at
  for (const op of change.ops as Op[]) {
    if (op.t === 'add') run.added = [...run.added, (op.node as { id: string }).id]
    if (op.t !== 'update') continue
    const node = before.nodes[op.id] as Record<string, unknown> | undefined
    if (!node) continue
    const prior = { ...run.prior[op.id] }
    for (const key of Object.keys(op.patch)) if (!(key in prior)) prior[key] = node[key] ?? null
    run.prior[op.id] = prior
  }
  return [...runs.filter((r) => r.runId !== runId), run].slice(-MAX_RUNS)
}

/**
 * Takes a server change (an ack or a `design.changed` event, in any order, any number of times).
 * In-order changes advance `confirmed`; later ones wait in the inbox for the gap to fill.
 */
export function receive(s: SessionState, change: StoredChange): SessionState {
  if (change.seq <= s.version || s.inbox[change.seq]) return s
  if (change.seq > s.version + 1) return { ...s, inbox: { ...s.inbox, [change.seq]: change } }
  let next = s
  let c: StoredChange | undefined = change
  while (c) {
    const before = next.confirmed
    const confirmed = applyOps(before, c.ops as Op[]).design
    const { [c.seq]: _taken, ...inbox } = next.inbox
    const ownChange = next.own[c.id]
    next = {
      ...next,
      confirmed,
      version: c.seq,
      inbox,
      pending: next.pending.filter((p) => p.id !== c!.id),
      own: ownChange ? { ...next.own, [c.id]: { ...ownChange, inverse: c.inverse as Op[] } } : next.own,
      runs: trackRun(next.runs, c, before),
    }
    c = next.inbox[next.version + 1]
  }
  return derive(next)
}

/** Whether changes are missing between `version` and what is waiting in the inbox. */
export const hasGap = (s: SessionState): boolean => Object.keys(s.inbox).length > 0

/** Takes a slice of history (any order, may overlap): what follows `version` is applied in order. */
export function catchUp(s: SessionState, changes: readonly StoredChange[]): SessionState {
  return changes.toSorted((a, b) => a.seq - b.seq).reduce(receive, s)
}

/**
 * Starts over from a fresh snapshot of the piece (the history could not bridge the gap).
 * Pending changes are kept and re-applied; a sent one the server already has is acknowledged
 * when it is retried under the same id.
 */
export function rebase(s: SessionState, design: Design, version: number): SessionState {
  const inbox = Object.fromEntries(Object.entries(s.inbox).filter(([seq]) => Number(seq) > version))
  return derive({ ...s, confirmed: design, version, inbox })
}

/** The server refused a change for good (invalid, or conflicting with later edits). */
export function reject(s: SessionState, id: string, reason: string): SessionState {
  const p = s.pending.find((x) => x.id === id)
  if (!p) return s
  const { [id]: _gone, ...own } = s.own
  return derive({
    ...s,
    pending: s.pending.filter((x) => x.id !== id),
    own,
    undo: s.undo.filter((x) => x !== id),
    redo: s.redo.filter((x) => x !== id),
    notices: [...s.notices, { type: 'dropped', label: p.label, reason }],
  })
}

export function clearNotices(s: SessionState): SessionState {
  return s.notices.length ? { ...s, notices: [] } : s
}
