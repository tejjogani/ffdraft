import { describe, expect, it } from 'vitest'
import { safeFileName } from './save-file'

describe('safe file names', () => {
  it('replaces characters Windows forbids and trims trailing dots', () => {
    expect(safeFileName('Ring: "Aurore" / v2?.', 'stl')).toBe('Ring Aurore v2.stl')
  })
  it('never produces a device name', () => {
    expect(safeFileName('CON', 'step')).toBe('CON_.step')
    expect(safeFileName('lpt1', 'stl')).toBe('lpt1_.stl')
  })
  it('falls back for empty names and caps the length', () => {
    expect(safeFileName('  ', 'glb')).toBe('Untitled.glb')
    expect(safeFileName('x'.repeat(300), 'stl').length).toBeLessThanOrEqual(120)
  })
})
