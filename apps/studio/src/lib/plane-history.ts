/**
 * Undo and redo for image planes. A plane is not part of the design, so it has its own history:
 * each change records the plane before and after (null = not in a view), and undoing places the
 * earlier value back with `references.place`. Pure; the store keeps one history per piece.
 */
import type { ImagePlane } from '@pave/schema'

export interface PlaneChange {
  refId: string
  before: ImagePlane | null
  after: ImagePlane | null
  /** "Moved the picture", for the Undo button's title and the toast. */
  label: string
}

export interface PlaneHistory {
  undo: PlaneChange[]
  redo: PlaneChange[]
}

export const EMPTY_HISTORY: PlaneHistory = { undo: [], redo: [] }
const MAX = 100

const same = (a: ImagePlane | null, b: ImagePlane | null) => JSON.stringify(a) === JSON.stringify(b)

/** A new change: it goes on the undo stack and clears redo. No-ops are not recorded. */
export function record(h: PlaneHistory, change: PlaneChange): PlaneHistory {
  if (same(change.before, change.after)) return h
  return { undo: [...h.undo, change].slice(-MAX), redo: [] }
}

/** What to place to undo the latest change, and the history after it. */
export function undoStep(
  h: PlaneHistory,
): { history: PlaneHistory; refId: string; plane: ImagePlane | null; label: string } | null {
  const last = h.undo.at(-1)
  if (!last) return null
  return {
    history: { undo: h.undo.slice(0, -1), redo: [...h.redo, last] },
    refId: last.refId,
    plane: last.before,
    label: last.label,
  }
}

export function redoStep(
  h: PlaneHistory,
): { history: PlaneHistory; refId: string; plane: ImagePlane | null; label: string } | null {
  const next = h.redo.at(-1)
  if (!next) return null
  return {
    history: { undo: [...h.undo, next], redo: h.redo.slice(0, -1) },
    refId: next.refId,
    plane: next.after,
    label: next.label,
  }
}

/** Forgets the changes of a picture that is no longer pinned (they cannot be placed back). */
export const forget = (h: PlaneHistory, refId: string): PlaneHistory => ({
  undo: h.undo.filter((c) => c.refId !== refId),
  redo: h.redo.filter((c) => c.refId !== refId),
})

/** The label for a change from what differs between before and after. */
export function changeLabel(before: ImagePlane | null, after: ImagePlane | null): string {
  if (!before && after) return `Placed the picture in the ${after.view} view`
  if (before && !after) return 'Took the picture out of the view'
  if (!before || !after) return 'Changed the picture'
  if (before.view !== after.view) return `Moved the picture to the ${after.view} view`
  if (before.locked !== after.locked)
    return after.locked ? 'Locked the picture' : 'Unlocked the picture'
  if (before.width !== after.width) return 'Scaled the picture'
  if (before.opacity !== after.opacity) return 'Faded the picture'
  return 'Moved the picture'
}
