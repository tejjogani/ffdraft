import { METALS } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { PLACEHOLDER_NOTE, roughCost } from './cost'

describe('rough cost from evaluation facts', () => {
  it('prices metal, stones, setting and labour by the production formula at placeholder rates', () => {
    const est = roughCost({
      metals: [{ material: 'au18k-yellow', massG: 3 }],
      lots: [
        { cut: 'round', stone: 'diamond', width: 6.4, count: 1, caratTotal: 1, setting: 'prong' },
      ],
    })
    const fineness = METALS['au18k-yellow'].fineness / 1000
    const metal = Math.round(3 * 1.05 * 130 * fineness * 1.15 * 100) / 100
    const labour = 31.5 + 25 + 60 + 5
    const materials = metal + 1500 + 20 + labour
    expect(est.perPiece.materials).toBeCloseTo(materials, 2)
    expect(est.perPiece.cost).toBeCloseTo(materials * 1.15, 1)
    expect(est.note).toBe(PLACEHOLDER_NOTE)
    // No plating fee: the facts do not say whether the piece is plated.
    expect(est.lines.some((l) => l.id === 'labour:plating')).toBe(false)
  })

  it('skips what it cannot price instead of failing', () => {
    const est = roughCost({
      metals: [{ material: 'unobtainium', massG: 3 }],
      lots: [
        { cut: 'round', stone: 'diamond', width: 1, count: 0, caratTotal: 0, setting: 'pave' },
      ],
    })
    expect(est.lines.filter((l) => l.group === 'metal' || l.group === 'stones')).toEqual([])
  })
})
