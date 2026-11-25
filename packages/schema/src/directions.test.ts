import { describe, expect, it } from 'vitest'
import { directionLetter, mixSpecs } from './design/directions'
import { type PieceSpec, PieceSpecSchema } from './design/spec'
import { TEMPLATES } from './recipes/index'

const spec = (id: string): PieceSpec =>
  PieceSpecSchema.parse(TEMPLATES.find((t) => t.id === id)!.spec)

describe('direction letters', () => {
  it('runs A to Z, then AA, AB', () => {
    expect([1, 2, 26, 27, 28, 52, 53].map(directionLetter)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
    ])
  })
})

describe('mixing directions', () => {
  const solitaire = spec('solitaire')
  const halo = spec('halo')
  const pave = spec('oval-pave')

  it('takes the head (archetype and hero stones) and leaves the band and size', () => {
    const sized = { ...pave, ring: { ...pave.ring!, size: { system: 'us' as const, value: 7 } } }
    const mixed = mixSpecs(sized, [{ spec: halo, parts: ['head'] }])
    expect(mixed.archetype).toBe('halo')
    expect(mixed.stones.map((s) => s.role)).toEqual(['center', 'halo', 'accent'])
    expect(mixed.stones[0]).toMatchObject({ cut: 'cushion', carat: 1.2 })
    // The band's set stones and the wearer's size are the base's.
    expect(mixed.stones[2]).toEqual(sized.stones[1])
    expect(mixed.ring).toEqual(sized.ring)
    expect(mixed.metal).toEqual(sized.metal)
  })

  it('takes the band with its set stones, keeping the base ring size', () => {
    const base = { ...solitaire, ring: { size: { system: 'uk' as const, value: 14 } } }
    const mixed = mixSpecs(base, [{ spec: pave, parts: ['band', 'metal'] }])
    expect(mixed.archetype).toBe('solitaire')
    expect(mixed.ring).toEqual({ ...pave.ring, size: { system: 'uk', value: 14 } })
    expect(mixed.stones.map((s) => s.role)).toEqual(['center', 'accent'])
    expect(mixed.stones[0]).toEqual(solitaire.stones[0])
    expect(mixed.metal).toEqual(pave.metal)
  })

  it('never changes its inputs, lets later takes win, and refuses other kinds', () => {
    const before = JSON.stringify([solitaire, halo, pave])
    const mixed = mixSpecs(solitaire, [
      { spec: halo, parts: ['metal'] },
      { spec: pave, parts: ['metal', 'style'] },
    ])
    expect(mixed.metal).toEqual(pave.metal)
    expect(mixed.style).toEqual(pave.style)
    expect(JSON.stringify([solitaire, halo, pave])).toBe(before)
    expect(() => mixSpecs(solitaire, [{ spec: spec('studs'), parts: ['head'] }])).toThrow(
      /earrings has no parts to lend a ring/,
    )
  })
})
