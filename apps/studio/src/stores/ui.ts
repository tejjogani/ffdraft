import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isNarrow } from '../lib/narrow'

interface UIState {
  sidebarCollapsed: boolean
  /** Phone-narrow windows: the sidebar is a drawer over the page, closed by default. */
  mobileNavOpen: boolean
  paletteOpen: boolean
  /** Collections expanded in the sidebar. */
  expandedCollections: string[]
  /** The one sidebar toggle: folds the column, or on a phone opens and closes the drawer. */
  toggleSidebar: () => void
  setMobileNav: (open: boolean) => void
  setPaletteOpen: (open: boolean) => void
  toggleCollection: (id: string) => void
}

/** UI-only state. Server data lives in TanStack Query, never here. */
export const useUI = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      paletteOpen: false,
      expandedCollections: [],
      toggleSidebar: () =>
        set((s) =>
          isNarrow()
            ? { mobileNavOpen: !s.mobileNavOpen }
            : { sidebarCollapsed: !s.sidebarCollapsed },
        ),
      setMobileNav: (mobileNavOpen) => set({ mobileNavOpen }),
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
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        expandedCollections: s.expandedCollections,
      }),
    },
  ),
)
