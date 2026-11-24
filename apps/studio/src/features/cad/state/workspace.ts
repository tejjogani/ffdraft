/**
 * What the Design tab shows and how, as opposed to what the design is: selection, hover,
 * view-only hiding, display mode, x-ray, fine-tuning and the ring-size system a designer
 * prefers to read. Preferences persist; the rest resets when another piece opens.
 */
import type { RingSizeSystem } from '@pave/schema'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type DisplayMode = 'rendered' | 'clay' | 'technical'

export interface Pick {
  nodeId: string
  /** A single stone of a pavé field / row (`${nodeId}:${index}`), when one was clicked. */
  stoneId?: string
}

interface WorkspaceState {
  pieceId: string | null
  selection: string[]
  /** The stone instance a second click picked, shown read-only in the inspector. */
  stone: string | null
  hover: Pick | null
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
  open(pieceId: string): void
  select(ids: string[], stone?: string | null): void
  /** Click on the model: first click selects the feature, a second on the same stone picks it. */
  pick(p: Pick | null, additive?: boolean): void
  setHover(p: Pick | null): void
  toggleHidden(id: string): void
  setRenaming(id: string | null): void
  setDisplay(mode: DisplayMode, chosen?: boolean): void
  toggleXray(): void
  setFineTune(on: boolean): void
  setRingSystem(system: RingSizeSystem | null): void
  setSimplified(on: boolean): void
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

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
          return s.select(has ? s.selection.filter((x) => x !== p.nodeId) : [...s.selection, p.nodeId])
        }
        const already = s.selection.length === 1 && s.selection[0] === p.nodeId
        s.select([p.nodeId], already && p.stoneId ? p.stoneId : null)
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
    }),
    {
      name: 'pave:cad',
      partialize: (s) => ({
        display: s.display,
        displayChosen: s.displayChosen,
        fineTune: s.fineTune,
        ringSystem: s.ringSystem,
      }),
    },
  ),
)
