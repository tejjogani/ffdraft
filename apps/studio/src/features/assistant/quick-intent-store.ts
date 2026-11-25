/**
 * Which quick-intent dialog is open, so a menu row (rendered anywhere, unmounted as soon as the
 * menu closes) can hand the subject to the one dialog host in the app shell; and how a ready
 * edit is applied from a surface that may or may not have the design open.
 */
import { newId, type Op } from '@pave/schema'
import { toast } from '@pave/ui'
import { create } from 'zustand'
import { type DesignSession, getDesignSession } from '../../lib/design-session/store'
import { rpc } from '../../lib/rpc'
import type { Subject } from './quick-intents'

export type StoneSubject = Extract<Subject, { type: 'stone' }>

/**
 * Where a quick-intent dialog docks on a piece's Design tab, in px from the window's edges:
 * over the inspector column when it is shown, else over the right of the 3D view, below its
 * toolbars and above its facts strip. `viewInset` is how much of the view that covers, for the
 * view to frame the piece in the rest.
 */
export interface DockArea {
  pieceId: string
  top: number
  right: number
  width: number
  height: number
  viewInset: number
}

interface QuickIntentState {
  replacing: StoneSubject | null
  dock: DockArea | null
  replaceStone(subject: StoneSubject): void
  close(): void
  setDock(dock: DockArea | null): void
}

export const useQuickIntent = create<QuickIntentState>()((set) => ({
  replacing: null,
  dock: null,
  replaceStone: (replacing) => set({ replacing }),
  close: () => set({ replacing: null }),
  setDock: (dock) => set({ dock }),
}))

/**
 * Commits ops as one change in a live session, with a toast whose Undo undoes exactly that
 * change: only while it is still the latest one to undo, so a toast left on screen after ⌘Z
 * cannot undo an older edit instead.
 */
export function commitWithUndo(session: DesignSession, ops: Op[], label: string): void {
  const id = newId('chg')
  session.commit(ops, { label, id })
  toast({
    title: label,
    action: {
      label: 'Undo',
      onClick: () => {
        if (session.get().undo.at(-1) === id) session.undo()
      },
    },
  })
}

/**
 * Applies a ready edit as one undoable change: through the piece's live session when the design
 * is open (so it lands at once and ⌘Z undoes it), otherwise straight to the server, where the
 * toast's Undo reverts that change by its number.
 */
export async function applyEdit(pieceId: string, ops: Op[], label: string): Promise<void> {
  if (!ops.length) return
  const session = getDesignSession(pieceId)
  if (session) return commitWithUndo(session, ops, label)
  try {
    const { change } = await rpc.call('design.apply', { pieceId, ops, label })
    toastServerChange(pieceId, label, change.seq)
  } catch (err) {
    toast.error('Couldn’t apply the change', (err as Error).message)
  }
}

/**
 * The toast for a change the server wrote: its Undo reverts that change by number, and says so
 * when the revert fails rather than leaving an unhandled rejection.
 */
export function toastServerChange(pieceId: string, label: string, seq: number | undefined): void {
  toast({
    title: label,
    ...(seq !== undefined
      ? {
          action: {
            label: 'Undo',
            onClick: () =>
              void rpc
                .call('design.revert', { pieceId, seq })
                .catch((err: Error) => toast.error('Couldn’t undo', err.message)),
          },
        }
      : {}),
  })
}
