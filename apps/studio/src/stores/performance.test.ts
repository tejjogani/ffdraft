/**
 * The Performance setting: Auto by default, remembered on this device, and an unknown value
 * (from another build, or edited by hand) reads as Auto instead of breaking the 3D views.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  })
  return store
}

async function load() {
  vi.resetModules()
  return (await import('./performance')).usePerformance
}

afterEach(() => vi.unstubAllGlobals())

describe('Performance setting', () => {
  it('is Auto by default', async () => {
    stubStorage()
    expect((await load()).getState().mode).toBe('auto')
  })

  it('remembers the choice on this device', async () => {
    const store = stubStorage()
    const perf = await load()
    perf.getState().setMode('smooth')
    expect(perf.getState().mode).toBe('smooth')
    expect(JSON.parse(store.get('pave:performance')!).state).toEqual({ mode: 'smooth' })
    // A new page load reads it back.
    expect((await load()).getState().mode).toBe('smooth')
  })

  it('reads an unknown stored value as Auto', async () => {
    stubStorage({ 'pave:performance': JSON.stringify({ state: { mode: 'turbo' }, version: 0 }) })
    expect((await load()).getState().mode).toBe('auto')
  })

  it('refuses an unknown mode', async () => {
    stubStorage()
    const perf = await load()
    perf.getState().setMode('sharp')
    perf.getState().setMode('turbo' as never)
    expect(perf.getState().mode).toBe('auto')
  })

  it('tells subscribers (the 3D views) when it changes', async () => {
    stubStorage()
    const perf = await load()
    const seen: string[] = []
    const off = perf.subscribe((s) => seen.push(s.mode))
    perf.getState().setMode('sharp')
    off()
    perf.getState().setMode('smooth')
    expect(seen).toEqual(['sharp'])
  })
})
