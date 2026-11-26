/**
 * The reference panel's UI state: whether it is open (remembered per browser), which source it
 * shows and the image plane being worked on with its undo history per piece.
 * Pins and planes themselves are server data in TanStack Query; nothing here is a copy of them.
 */
import type { ImagePlane, ImagePlaneView } from '@pave/schema'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Rect } from '../../lib/float-window'
import {
  EMPTY_HISTORY,
  forget,
  type PlaneChange,
  type PlaneHistory,
  record,
} from '../../lib/plane-history'
import type { SketchEntry } from './sketch'

export type PanelSource = 'pinned' | 'search' | 'piece' | 'boards'
/** The reference window's tabs; Generated shows only when an image model is configured. */
export type ReferenceTab = 'references' | 'sketch' | 'generated'
/** Docked beside the CAD (a column of the workbench) or floating over it as a glass window. */
export type ReferenceLayout = 'docked' | 'floating'

interface ReferencePanelState {
  open: boolean
  layout: ReferenceLayout
  /** The floating window's place and size, remembered; null until it first floats. */
  rect: Rect | null
  tab: ReferenceTab
  source: PanelSource
  /** The pinned reference being dragged toward the viewport (shows the view drop zones). */
  dragging: string | null
  /** The image plane being worked on in the CAD view. */
  selected: { pieceId: string; refId: string } | null
  /** The two-point scale tool on the selected plane. */
  scaling: boolean
  /** A plane's live position while it is dragged, before the change is saved. */
  preview: { refId: string; plane: ImagePlane } | null
  histories: Record<string, PlaneHistory>
  /** The sketch on the pad, per piece, for this window's session (saving makes it a pin). */
  sketches: Record<string, SketchEntry[]>
  setSketch: (pieceId: string, entries: SketchEntry[]) => void
  /** "Lay this pin in that view", for the CAD view to carry out (it knows the piece's size). */
  placeRequest: { pieceId: string; refId: string; view: ImagePlaneView } | null
  /** The piece whose CAD view is on screen and takes place requests; null when none is. */
  viewport: string | null
  setPlaceRequest: (r: { pieceId: string; refId: string; view: ImagePlaneView } | null) => void
  setViewport: (pieceId: string | null) => void
  setOpen: (open: boolean) => void
  toggle: () => void
  setLayout: (layout: ReferenceLayout, rect?: Rect) => void
  setRect: (rect: Rect) => void
  setTab: (tab: ReferenceTab) => void
  setSource: (source: PanelSource) => void
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
      layout: 'docked',
      rect: null,
      tab: 'references',
      source: 'pinned',
      dragging: null,
      selected: null,
      scaling: false,
      preview: null,
      histories: {},
      sketches: {},
      setSketch: (pieceId, entries) =>
        set((s) => ({ sketches: { ...s.sketches, [pieceId]: entries } })),
      placeRequest: null,
      viewport: null,
      setPlaceRequest: (placeRequest) => set({ placeRequest }),
      setViewport: (viewport) => set({ viewport }),
      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),
      setLayout: (layout, rect) => set((s) => ({ layout, open: true, rect: rect ?? s.rect })),
      setRect: (rect) => set({ rect }),
      setTab: (tab) => set({ tab }),
      setSource: (source) => set({ source }),
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
      partialize: persistedReferences,
    },
  ),
)

/**
 * Only conveniences survive a reload: open or not, docked or floating and where, the tab and
 * source. The undo history is for this window's session.
 */
export function persistedReferences(s: ReferencePanelState) {
  return {
    open: s.open,
    layout: s.layout,
    rect: s.rect,
    tab: s.tab,
    source: s.source,
  }
}

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
