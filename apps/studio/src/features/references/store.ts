/**
 * The reference panel's UI state: whether it is open (remembered per browser), which source it
 * shows, the search words, and the image plane being worked on with its undo history per piece.
 * Pins and planes themselves are server data in TanStack Query; nothing here is a copy of them.
 */
import type { ImagePlane, ImagePlaneView } from '@pave/schema'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  EMPTY_HISTORY,
  forget,
  type PlaneChange,
  type PlaneHistory,
  record,
} from '../../lib/plane-history'

export type PanelSource = 'pinned' | 'search' | 'piece' | 'boards'

interface ReferencePanelState {
  open: boolean
  source: PanelSource
  query: string
  openOnly: boolean
  /** The pinned reference being dragged toward the viewport (shows the view drop zones). */
  dragging: string | null
  /** The image plane being worked on in the CAD view. */
  selected: { pieceId: string; refId: string } | null
  /** The two-point scale tool on the selected plane. */
  scaling: boolean
  /** A plane's live position while it is dragged, before the change is saved. */
  preview: { refId: string; plane: ImagePlane } | null
  histories: Record<string, PlaneHistory>
  /** "Lay this pin in that view", for the CAD view to carry out (it knows the piece's size). */
  placeRequest: { pieceId: string; refId: string; view: ImagePlaneView } | null
  /** The piece whose CAD view is on screen and takes place requests; null when none is. */
  viewport: string | null
  setPlaceRequest: (r: { pieceId: string; refId: string; view: ImagePlaneView } | null) => void
  setViewport: (pieceId: string | null) => void
  setOpen: (open: boolean) => void
  toggle: () => void
  setSource: (source: PanelSource) => void
  setQuery: (query: string) => void
  setOpenOnly: (openOnly: boolean) => void
  setDragging: (refId: string | null) => void
  select: (selected: { pieceId: string; refId: string } | null) => void
  setScaling: (scaling: boolean) => void
  setPreview: (preview: { refId: string; plane: ImagePlane } | null) => void
  recordChange: (pieceId: string, change: PlaneChange) => void
  setHistory: (pieceId: string, history: PlaneHistory) => void
  forgetRef: (pieceId: string, refId: string) => void
}

export const useReferencePanel = create<ReferencePanelState>()(
  persist(
    (set) => ({
      open: false,
      source: 'pinned',
      query: '',
      openOnly: false,
      dragging: null,
      selected: null,
      scaling: false,
      preview: null,
      histories: {},
      placeRequest: null,
      viewport: null,
      setPlaceRequest: (placeRequest) => set({ placeRequest }),
      setViewport: (viewport) => set({ viewport }),
      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),
      setSource: (source) => set({ source }),
      setQuery: (query) => set({ query }),
      setOpenOnly: (openOnly) => set({ openOnly }),
      setDragging: (dragging) => set({ dragging }),
      select: (selected) => set({ selected, scaling: false, preview: null }),
      setScaling: (scaling) => set({ scaling }),
      setPreview: (preview) => set({ preview }),
      recordChange: (pieceId, change) =>
        set((s) => ({
          histories: {
            ...s.histories,
            [pieceId]: record(s.histories[pieceId] ?? EMPTY_HISTORY, change),
          },
        })),
      setHistory: (pieceId, history) =>
        set((s) => ({ histories: { ...s.histories, [pieceId]: history } })),
      forgetRef: (pieceId, refId) =>
        set((s) => ({
          histories: {
            ...s.histories,
            [pieceId]: forget(s.histories[pieceId] ?? EMPTY_HISTORY, refId),
          },
          selected: s.selected?.refId === refId ? null : s.selected,
        })),
    }),
    {
      name: 'pave:references',
      // Only conveniences survive a reload; the undo history is for this window's session.
      partialize: (s) => ({ open: s.open, source: s.source, openOnly: s.openOnly }),
    },
  ),
)

/** The plane history of a piece, for components and commands. */
export const historyOf = (pieceId: string): PlaneHistory =>
  useReferencePanel.getState().histories[pieceId] ?? EMPTY_HISTORY

/** Whether a plane change should take mod+z / mod+shift+z ahead of the design's own undo. */
export function planeHasFocus(pieceId: string, which: 'undo' | 'redo'): boolean {
  const s = useReferencePanel.getState()
  return s.selected?.pieceId === pieceId && historyOf(pieceId)[which].length > 0
}

/** The drag type a pinned reference travels under, to the CAD view or within the pin list. */
export const PIN_DRAG_TYPE = 'application/x-pave-pin'
