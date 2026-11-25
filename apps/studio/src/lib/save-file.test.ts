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
  it('never produces a device name before a dot either: Windows reads "CON.v2.stl" as CON', () => {
    expect(safeFileName('CON.backup', 'stl')).toBe('CON_.backup.stl')
    expect(safeFileName('nul.v2', 'stl')).toBe('nul_.v2.stl')
    expect(safeFileName('aux .final', 'stl')).toBe('aux_ .final.stl')
    // Only the whole first part counts.
    expect(safeFileName('Console.v2', 'stl')).toBe('Console.v2.stl')
    expect(safeFileName('icon', 'stl')).toBe('icon.stl')
  })
  it('does not cut a name in the middle of a character', () => {
    expect(safeFileName(`${'a'.repeat(115)}💎💎`, 'stl')).toBe(`${'a'.repeat(115)}.stl`)
    expect(safeFileName(`${'a'.repeat(114)}💎💎`, 'stl')).toBe(`${'a'.repeat(114)}💎.stl`)
  })
  it('keeps unicode and collapses whitespace', () => {
    expect(safeFileName('  Bague   « Étoile »\tn°2 ', 'step')).toBe('Bague « Étoile » n°2.step')
    expect(safeFileName('指輪', '3mf')).toBe('指輪.3mf')
  })
  it('falls back for empty names and caps the length', () => {
    expect(safeFileName('  ', 'glb')).toBe('Untitled.glb')
    expect(safeFileName('x'.repeat(300), 'stl').length).toBeLessThanOrEqual(120)
  })
})
