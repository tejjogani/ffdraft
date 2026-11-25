/**
 * Implicit feedback read from the edit history: soon after the assistant changed a piece, did a
 * person change the same thing again (`corrected`) or delete what it added (`removed`)? Pure: the
 * server's post-commit hook feeds it the agent's change and the changes that followed it.
 * (`undone` is recorded exactly by `design.revert`, not guessed here.)
 */
import type { StoredChange } from '@pave/schema'

type ChangeOp = StoredChange['ops'][number]

/** How many later changes are looked at; beyond that a change is the designer's own idea. */
export const FEEDBACK_WINDOW = 10

export interface DetectedFeedback {
  kind: 'corrected' | 'removed'
  /** The assistant's change the signal is about. */
  changeId: string
  /** The person's change that gave it. */
  byChangeId: string
  detail: string
}

const isPerson = (c: StoredChange) => c.actor.type === 'user'

/** Node id → the top-level fields the ops set (an added node sets all of its fields). */
function touched(ops: readonly ChangeOp[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (id: string, keys: Iterable<string>) => {
    const set = out.get(id) ?? new Set<string>()
    for (const k of keys) set.add(k)
    out.set(id, set)
  }
  for (const op of ops) {
    if (op.t === 'update') add(op.id, Object.keys(op.patch))
    else if (op.t === 'add' && typeof op.node.id === 'string')
      add(
        op.node.id,
        Object.keys(op.node).filter((k) => k !== 'id' && k !== 'kind'),
      )
  }
  return out
}

const added = (ops: readonly ChangeOp[]) =>
  new Set(
    ops.flatMap((op) => (op.t === 'add' && typeof op.node.id === 'string' ? [op.node.id] : [])),
  )

/**
 * Feedback on `agent` from the changes after it (oldest first, same piece). Each kind is
 * reported once per node and field; a person's change that undoes the agent's change exactly is
 * left to `design.revert`'s record.
 */
export function detectFeedback(
  agent: StoredChange,
  later: readonly StoredChange[],
): DetectedFeedback[] {
  if (agent.actor.type !== 'agent') return []
  const mine = touched(agent.ops)
  const mineAdded = added(agent.ops)
  const out: DetectedFeedback[] = []
  const seen = new Set<string>()
  for (const c of later.slice(0, FEEDBACK_WINDOW)) {
    if (!isPerson(c) || c.reverts?.includes(agent.id)) continue
    for (const op of c.ops) {
      if (op.t === 'remove' && mineAdded.has(op.id) && !seen.has(`removed:${op.id}`)) {
        seen.add(`removed:${op.id}`)
        out.push({
          kind: 'removed',
          changeId: agent.id,
          byChangeId: c.id,
          detail: `Removed ${op.id}, which the assistant added in “${agent.label}”.`,
        })
      }
      if (op.t !== 'update') continue
      const fields = mine.get(op.id)
      if (!fields) continue
      for (const key of Object.keys(op.patch)) {
        if (!fields.has(key) || seen.has(`corrected:${op.id}.${key}`)) continue
        seen.add(`corrected:${op.id}.${key}`)
        out.push({
          kind: 'corrected',
          changeId: agent.id,
          byChangeId: c.id,
          detail: `Changed ${op.id}.${key} again after the assistant set it in “${agent.label}”.`,
        })
      }
    }
  }
  return out
}
