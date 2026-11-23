import { useSyncExternalStore } from 'react'
import { readStored, writeStored } from './storage'
import { THEME_STORAGE_KEY } from './theme-boot'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
const listeners = new Set<() => void>()
let preference: ThemePreference = readStored<ThemePreference>(THEME_STORAGE_KEY, 'system')

const resolve = (p: ThemePreference): ResolvedTheme => (p === 'system' ? (media?.matches ? 'dark' : 'light') : p)

function apply() {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = resolve(preference)
  for (const l of listeners) l()
}

media?.addEventListener('change', () => preference === 'system' && apply())
apply()

export function setTheme(p: ThemePreference): void {
  preference = p
  writeStored(THEME_STORAGE_KEY, p)
  apply()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
// A string snapshot so a system change re-renders even when the preference is unchanged.
const snapshot = () => `${preference}|${resolve(preference)}`

/** The theme preference (persisted, follows the system by default) and what it resolves to. */
export function useTheme(): { preference: ThemePreference; resolved: ResolvedTheme; setTheme: typeof setTheme } {
  const [p, r] = useSyncExternalStore(subscribe, snapshot).split('|') as [ThemePreference, ResolvedTheme]
  return { preference: p, resolved: r, setTheme }
}
