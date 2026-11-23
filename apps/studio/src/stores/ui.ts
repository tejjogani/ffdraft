import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  sidebarCollapsed: boolean
  paletteOpen: boolean
  /** Collections expanded in the sidebar. */
  expandedCollections: string[]
  toggleSidebar: () => void
  setPaletteOpen: (open: boolean) => void
  toggleCollection: (id: string) => void
}

/** UI-only state. Server data lives in TanStack Query, never here. */
export const useUI = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      paletteOpen: false,
      expandedCollections: [],
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      toggleCollection: (id) =>
        set((s) => ({
          expandedCollections: s.expandedCollections.includes(id)
            ? s.expandedCollections.filter((c) => c !== id)
            : [...s.expandedCollections, id],
        })),
    }),
    {
      name: 'pave:ui',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, expandedCollections: s.expandedCollections }),
    },
  ),
)
