/**
 * The rules of a shot's change history, shared by the server (which enforces them) and the
 * studio (which offers Undo and Redo):
 *
 *  - every change to a saved shot is kept with the scene before and after;
 *  - undoing a change is itself a change that `reverts` it, so it can be undone too (a redo);
 *  - Undo takes the newest edit (or redo) still in effect, Redo the newest undo still in effect,
 *    as long as nothing was edited after it;
 *  - a locked camera moves only after a person unlocks it.
 */
import { diffPatch, type RenderScene, type SceneChange } from '@pave/schema'

type Change = Pick<SceneChange, 'id' | 'seq' | 'reverts' | 'revertedBy'>

export type ChangeKind = 'edit' | 'undo' | 'redo'

/** Edit: made directly; undo: reverts an edit or a redo; redo: reverts an undo. */
export function kindsOf<C extends Change>(changes: readonly C[]): Map<string, ChangeKind> {
  const byId = new Map(changes.map((c) => [c.id, c]))
  const kinds = new Map<string, ChangeKind>()
  const kind = (c: C, depth = 0): ChangeKind => {
    const known = kinds.get(c.id)
    if (known) return known
    const target = c.reverts ? byId.get(c.reverts) : undefined
    // A revert whose target is outside the list (older than the page) counts as an undo.
    const k: ChangeKind = !c.reverts
      ? 'edit'
      : !target || depth > 64
        ? 'undo'
        : kind(target, depth + 1) === 'undo'
          ? 'redo'
          : 'undo'
    kinds.set(c.id, k)
    return k
  }
  for (const c of changes) kind(c)
  return kinds
}

const newestFirst = <C extends Change>(changes: readonly C[]) =>
  changes.toSorted((a, b) => b.seq - a.seq)

/** The change Undo reverts: the newest edit or redo still in effect. */
export function undoTarget<C extends Change>(changes: readonly C[]): C | null {
  const kinds = kindsOf(changes)
  return (
    newestFirst(changes).find((c) => c.revertedBy === null && kinds.get(c.id) !== 'undo') ?? null
  )
}

/** The change Redo reverts: the newest undo still in effect, unless an edit came after it. */
export function redoTarget<C extends Change>(changes: readonly C[]): C | null {
  const kinds = kindsOf(changes)
  for (const c of newestFirst(changes)) {
    const k = kinds.get(c.id)
    if (k === 'edit') return null
    if (k === 'undo' && c.revertedBy === null) return c
  }
  return null
}

/** The camera settings a change moves (everything but the lock itself). */
export function cameraMoves(before: RenderScene, after: RenderScene): string[] {
  const diff = diffPatch(
    before.camera as Record<string, unknown>,
    after.camera as Record<string, unknown>,
  )
  return Object.keys(diff).filter((k) => k !== 'locked')
}

/**
 * Why a change to a shot is not allowed, or null. A locked camera cannot be moved (a person may
 * unlock and move it in one change); only a person can lock or unlock it.
 */
export function shotChangeRefusal(
  before: RenderScene,
  after: RenderScene,
  by: 'person' | 'agent',
): string | null {
  const locking = (before.camera.locked ?? false) !== (after.camera.locked ?? false)
  if (locking && by === 'agent')
    return 'Only a person can lock or unlock a shot’s camera. Ask the designer to unlock it.'
  const unlockedNow = by === 'person' && after.camera.locked !== true
  if (before.camera.locked && !unlockedNow && cameraMoves(before, after).length > 0)
    return by === 'agent'
      ? 'This shot’s camera is locked, so its framing stays as the designer set it. Change the look, light or size instead, or ask the designer to unlock it.'
      : 'This shot’s camera is locked. Unlock it to move it.'
  return null
}
