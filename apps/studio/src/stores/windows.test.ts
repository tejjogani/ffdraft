/**
 * The assistant and reference windows remember where they were: docked or floating, their
 * place and size, folded to a pill, the reference window's tab. Each test loads the stores
 * fresh over a stand-in localStorage, the way a reload does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

/** zustand's persist reads `window.localStorage` (and stays off without a window, as in SSR). */
function stubStorage() {
  vi.stubGlobal('window', { localStorage: memoryStorage() })
}

async function load() {
  vi.resetModules()
  const a = await import('./assistant')
  const r = await import('../features/references/store')
  // persist rehydrates synchronously from a synchronous storage.
  return { assistant: a, refs: r }
}

afterEach(() => vi.unstubAllGlobals())

describe('the assistant window', () => {
  it('docks, floats, collapses to a pill, and remembers all of it across a reload', async () => {
    stubStorage()
    const first = await load()
    const s = first.assistant.useAssistant
    expect(s.getState()).toMatchObject({ isOpen: false, layout: 'docked', collapsed: false })

    s.getState().open()
    expect(first.assistant.isDockedOpen(s.getState())).toBe(true)
    // Pulled out of the sidebar: floating where the person put it, no longer a page column.
    s.getState().setLayout('floating', { x: 200, y: 120, w: 420, h: 600 })
    expect(first.assistant.isDockedOpen(s.getState())).toBe(false)
    s.getState().setRect({ x: 260, y: 140, w: 440, h: 640 })
    // Collapsed to the pill; mod+j opens it again rather than closing it.
    s.getState().setCollapsed(true)
    first.assistant.assistant.toggle()
    expect(s.getState()).toMatchObject({ isOpen: true, collapsed: false })
    s.getState().setCollapsed(true)

    const again = await load()
    expect(again.assistant.useAssistant.getState()).toMatchObject({
      isOpen: true,
      layout: 'floating',
      collapsed: true,
      rect: { x: 260, y: 140, w: 440, h: 640 },
    })
    // Snapped back into the sidebar, and that is remembered too; the floating place is kept.
    again.assistant.useAssistant.getState().setLayout('docked')
    const third = await load()
    expect(third.assistant.useAssistant.getState()).toMatchObject({
      layout: 'docked',
      collapsed: false,
      rect: { x: 260, y: 140, w: 440, h: 640 },
    })
    // Closing forgets the pill, so the next open shows the window.
    third.assistant.useAssistant.getState().close()
    third.assistant.useAssistant.getState().toggle()
    expect(third.assistant.useAssistant.getState()).toMatchObject({
      isOpen: true,
      collapsed: false,
    })
  })

  it('opening it for a part (Ask AI) never leaves it folded', async () => {
    stubStorage()
    const { assistant } = await load()
    assistant.useAssistant.getState().open()
    assistant.useAssistant.getState().setCollapsed(true)
    assistant.openAssistant({ pieceId: 'pc_1', selection: ['head'] })
    expect(assistant.useAssistant.getState()).toMatchObject({ isOpen: true, collapsed: false })
  })

  it('keeps no draft or selection across a reload', async () => {
    stubStorage()
    const { assistant } = await load()
    assistant.useAssistant.getState().setDraft('half-written')
    expect(
      Object.keys(assistant.persistedAssistant(assistant.useAssistant.getState())).sort(),
    ).toEqual(['activeThreadId', 'collapsed', 'isOpen', 'layout', 'rect', 'tierByThread', 'width'])
  })
})

describe('the reference window', () => {
  it('docks beside the CAD or floats, keeps its tab, and remembers them across a reload', async () => {
    stubStorage()
    const { refs } = await load()
    const s = refs.useReferencePanel
    expect(s.getState()).toMatchObject({ open: false, layout: 'docked', tab: 'references' })
    s.getState().setLayout('floating', { x: 80, y: 90, w: 360, h: 520 })
    expect(s.getState().open).toBe(true)
    s.getState().setTab('sketch')
    s.getState().setRect({ x: 100, y: 100, w: 380, h: 540 })

    const again = await load()
    expect(again.refs.useReferencePanel.getState()).toMatchObject({
      open: true,
      layout: 'floating',
      tab: 'sketch',
      rect: { x: 100, y: 100, w: 380, h: 540 },
    })
    // Closed, it stays closed after a reload, still floating for next time.
    again.refs.useReferencePanel.getState().setOpen(false)
    const third = await load()
    expect(third.refs.useReferencePanel.getState()).toMatchObject({
      open: false,
      layout: 'floating',
    })
    third.refs.useReferencePanel.getState().setLayout('docked')
    const fourth = await load()
    expect(fourth.refs.useReferencePanel.getState()).toMatchObject({ open: true, layout: 'docked' })
  })
})
