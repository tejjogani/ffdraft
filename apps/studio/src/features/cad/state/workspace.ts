/**
 * What the Design tab shows and how, as opposed to what the design is: selection, hover,
 * view-only hiding, display mode, x-ray, fine-tuning, the ring-size system a designer
 * prefers to read and what their scroll wheel is. Preferences persist; the rest resets when another piece opens.
 */
import type { RingSizeSystem } from '@pave/schema'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WheelDevice } from '../../../components/stage/wheel'

export type DisplayMode = 'rendered' | 'clay' | 'technical'

export interface NodePick {
  nodeId: string
  /** A single stone of a pavé field / row (`${nodeId}:${index}`), when one was clicked. */
  stoneId?: string
}

interface WorkspaceState {
  pieceId: string | null
  selection: string[]
  /** The stone instance a second click picked, shown read-only in the inspector. */
  stone: string | null
  hover: NodePick | null
  /** Hidden in this view only: unlike "Exclude from piece", weight and exports are unchanged. */
  hidden: string[]
  renaming: string | null
  display: DisplayMode
  /** The designer picked a display mode (so a software GPU does not switch it to clay). */
  displayChosen: boolean
  xray: boolean
  fineTune: boolean
  /** The system ring sizes are read and picked in; null = each band's own. */
  ringSystem: RingSizeSystem | null
  /** Set when the GPU cannot run the full material shaders. */
  simplified: boolean
  /** How wheel input is read; `auto` tells a mouse from a trackpad per gesture. */
  wheel: WheelDevice
  open(pieceId: string): void
  select(ids: string[], stone?: string | null): void
  /** Click on the model: first click selects the feature, a second on the same stone picks it. */
  pick(p: NodePick | null, additive?: boolean): void
  /** A right-click on a feature (or empty space): see `menuSelection`. Returns what the menu acts on. */
  selectForMenu(nodeId: string | null): string[]
  /**
   * Forgets features that are no longer in the design (an undo took back an addition, a teammate
   * or the assistant deleted one): they leave the selection, the hover and a rename in progress.
   */
  retain(exists: (nodeId: string) => boolean): void
  setHover(p: NodePick | null): void
  toggleHidden(id: string): void
  setRenaming(id: string | null): void
  setDisplay(mode: DisplayMode, chosen?: boolean): void
  toggleXray(): void
  setFineTune(on: boolean): void
  setRingSystem(system: RingSizeSystem | null): void
  setSimplified(on: boolean): void
  setWheel(device: WheelDevice): void
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The selection after a right-click, as in every CAD tool: on a feature already selected it
 * stays as it is, so Hide and Delete in the menu act on all of it; on anything else it becomes
 * that feature (or nothing, for empty space), so the menu and the highlight agree.
 */
export const menuSelection = (selection: readonly string[], nodeId: string | null): string[] =>
  nodeId === null ? [] : selection.includes(nodeId) ? [...selection] : [nodeId]

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      pieceId: null,
      selection: [],
      stone: null,
      hover: null,
      hidden: [],
      renaming: null,
      display: 'rendered',
      displayChosen: false,
      xray: false,
      fineTune: false,
      ringSystem: null,
      simplified: false,
      wheel: 'auto',
      open: (pieceId) => {
        if (get().pieceId !== pieceId)
          set({ pieceId, selection: [], stone: null, hover: null, hidden: [], renaming: null })
      },
      select: (ids, stone = null) => {
        const s = get()
        if (same(s.selection, ids) && s.stone === stone) return
        set({ selection: ids, stone })
      },
      pick: (p, additive) => {
        const s = get()
        if (!p) return s.select([])
        if (additive) {
          const has = s.selection.includes(p.nodeId)
          return s.select(
            has ? s.selection.filter((x) => x !== p.nodeId) : [...s.selection, p.nodeId],
          )
        }
        const already = s.selection.length === 1 && s.selection[0] === p.nodeId
        s.select([p.nodeId], already && p.stoneId ? p.stoneId : null)
      },
      selectForMenu: (nodeId) => {
        const s = get()
        const ids = menuSelection(s.selection, nodeId)
        // A kept selection keeps its picked stone too.
        if (!same(ids, s.selection)) s.select(ids)
        return ids
      },
      retain: (exists) => {
        const s = get()
        const selection = s.selection.filter(exists)
        const next: Partial<WorkspaceState> = {}
        // A picked stone belongs to the one selected feature.
        if (selection.length !== s.selection.length) Object.assign(next, { selection, stone: null })
        if (s.hover && !exists(s.hover.nodeId)) next.hover = null
        if (s.renaming && !exists(s.renaming)) next.renaming = null
        if (Object.keys(next).length) set(next)
      },
      setHover: (hover) => {
        const h = get().hover
        if (h?.nodeId === hover?.nodeId && h?.stoneId === hover?.stoneId) return
        set({ hover })
      },
      toggleHidden: (id) =>
        set((s) => ({
          hidden: s.hidden.includes(id) ? s.hidden.filter((x) => x !== id) : [...s.hidden, id],
        })),
      setRenaming: (renaming) => set({ renaming }),
      setDisplay: (display, chosen = true) =>
        set((s) => ({ display, displayChosen: s.displayChosen || chosen })),
      toggleXray: () => set((s) => ({ xray: !s.xray })),
      setFineTune: (fineTune) => set({ fineTune }),
      setRingSystem: (ringSystem) => set({ ringSystem }),
      setSimplified: (simplified) => set({ simplified }),
      setWheel: (wheel) => set({ wheel }),
    }),
    {
      name: 'pave:cad',
      partialize: (s) => ({
        display: s.display,
        displayChosen: s.displayChosen,
        fineTune: s.fineTune,
        ringSystem: s.ringSystem,
        wheel: s.wheel,
      }),
    },
  ),
)
