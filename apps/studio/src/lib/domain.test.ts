import { describe, expect, it } from 'vitest'
import { factsLine, hasFacts } from './domain'

describe('facts on cards', () => {
  it('names the kind for an idea with nothing built yet, never "0 g"', () => {
    const empty = { metalMassG: 0, caratTotal: 0, stoneCount: 0, metal: '' }
    expect(hasFacts(empty)).toBe(false)
    expect(hasFacts(null)).toBe(false)
    expect(factsLine({ kind: 'ring', facts: empty })).toBe('Ring')
    expect(factsLine({ kind: 'ring', facts: null })).toBe('Ring')
  })

  it('gives metal, weight and carats once the piece has a weight', () => {
    const built = { metalMassG: 3.2, caratTotal: 1.52, stoneCount: 3, metal: 'au18k-yellow' }
    expect(hasFacts(built)).toBe(true)
    expect(factsLine({ kind: 'ring', facts: built })).toMatch(/18k Yellow Gold · 3\.2 g · 1\.52 ct/)
  })
})
