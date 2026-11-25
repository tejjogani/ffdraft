/**
 * The Performance setting: how the 3D views trade sharpness for smoothness on this device.
 * A per-device choice (a laptop and a desktop want different answers), so it lives in the
 * browser, like the theme, and never on the server. The 3D views read it outside React through
 * `usePerformance.getState()` and `subscribe`.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PERFORMANCE_MODES, type PerformanceMode } from '../components/stage/adaptive'

export const DEFAULT_PERFORMANCE_MODE: PerformanceMode = 'auto'

/** The words the setting and the viewport's indicator use, one place for both. */
export const PERFORMANCE_WORDS: Record<PerformanceMode, { label: string; blurb: string }> = {
  auto: {
    label: 'Auto',
    blurb:
      'Draws lighter while you orbit or drag, then sharpens when you stop. Steps down further only if this computer can’t keep up.',
  },
  smooth: {
    label: 'Smooth',
    blurb: 'Always the lighter picture: smoothest on a laptop without a dedicated graphics card.',
  },
  sharp: {
    label: 'Sharp',
    blurb:
      'Full detail at the screen’s own resolution, even while moving. Can feel slow on a laptop.',
  },
}

interface PerformanceState {
  mode: PerformanceMode
  setMode: (mode: PerformanceMode) => void
}

export const isPerformanceMode = (v: unknown): v is PerformanceMode =>
  typeof v === 'string' && (PERFORMANCE_MODES as readonly string[]).includes(v)

export const usePerformance = create<PerformanceState>()(
  persist(
    (set) => ({
      mode: DEFAULT_PERFORMANCE_MODE,
      setMode: (mode) => set({ mode: isPerformanceMode(mode) ? mode : DEFAULT_PERFORMANCE_MODE }),
    }),
    {
      name: 'pave:performance',
      partialize: (s) => ({ mode: s.mode }),
      // A value written by a newer or older build that this one does not know reads as Auto.
      merge: (persisted, current) => {
        const mode = (persisted as { mode?: unknown } | undefined)?.mode
        return { ...current, mode: isPerformanceMode(mode) ? mode : DEFAULT_PERFORMANCE_MODE }
      },
    },
  ),
)
