import { useSyncExternalStore } from 'react'

/**
 * Below this width the sidebar stops being a column and becomes a drawer over the page (a phone,
 * or a very narrow window). Tailwind's `md` breakpoint, so CSS and code agree.
 */
export const NARROW_QUERY = '(max-width: 767px)'

const media = (): MediaQueryList | null =>
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW_QUERY) : null

export function isNarrow(): boolean {
  return media()?.matches ?? false
}

function subscribe(onChange: () => void): () => void {
  const m = media()
  m?.addEventListener('change', onChange)
  return () => m?.removeEventListener('change', onChange)
}

/** True while the window is phone-narrow; re-renders when that changes. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, isNarrow, () => false)
}
