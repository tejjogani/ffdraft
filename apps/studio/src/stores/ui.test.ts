/**
 * The one sidebar toggle: on a wide window it folds the sidebar column (and remembers that); on a
 * phone-narrow window the sidebar is a drawer, so the same toggle opens and closes the drawer and
 * leaves the remembered column alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

function stubWindow(narrow: boolean) {
  const store = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    matchMedia: (query: string) => ({
      matches: narrow,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
  })
}

async function load() {
  vi.resetModules()
  return (await import('./ui')).useUI
}

afterEach(() => vi.unstubAllGlobals())

describe('sidebar toggle', () => {
  it('folds the column on a wide window', async () => {
    stubWindow(false)
    const ui = await load()
    ui.getState().toggleSidebar()
    expect(ui.getState().sidebarCollapsed).toBe(true)
    expect(ui.getState().mobileNavOpen).toBe(false)
  })

  it('opens and closes the drawer on a phone, without touching the remembered column', async () => {
    stubWindow(true)
    const ui = await load()
    ui.getState().toggleSidebar()
    expect(ui.getState().mobileNavOpen).toBe(true)
    expect(ui.getState().sidebarCollapsed).toBe(false)
    ui.getState().toggleSidebar()
    expect(ui.getState().mobileNavOpen).toBe(false)
  })
})
