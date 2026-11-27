import { describe, expect, it } from 'vitest'
import { sourceRenderAppearance } from './source-appearance'

describe('imported visual appearance', () => {
  const base = { groups: [], placements: [] }
  it('uses bound gem and metal materials on an existing file without RGB', () => {
    expect(
      sourceRenderAppearance({
        ...base,
        material: '/Emerald-01234567-89ab-cdef-1234-0123456789ab',
      }),
    ).toMatchObject({ kind: 'gem', stone: 'emerald' })
    expect(sourceRenderAppearance({ ...base, material: 'White Gold' })).toMatchObject({
      kind: 'metal',
    })
    expect(
      sourceRenderAppearance({
        ...base,
        stullerMaterial: { stoneFamily: 'Diamond', stoneColor: 'G-H' },
      }),
    ).toMatchObject({ kind: 'gem', stone: 'diamond' })
    expect(
      sourceRenderAppearance({
        ...base,
        stullerMaterial: { stoneFamily: 'Sapphire', stoneColor: 'Blue' },
      }),
    ).toMatchObject({ kind: 'gem', stone: 'sapphire-blue' })
    expect(
      sourceRenderAppearance({
        ...base,
        material: 'Fancy pink diamond',
        stullerMaterial: { stoneFamily: 'Diamond' },
      }),
    ).toMatchObject({ kind: 'gem', stone: 'diamond-pink' })
    expect(sourceRenderAppearance({ ...base, material: 'unknown' })).toBeUndefined()
  })
  it('uses actual diffuse and opacity of a bound custom material and stops at an unbound intermediate placement', () => {
    const outside = {
      id: 'parent',
      definitionId: 'block',
      material: 'Enamel',
      materialAppearance: { color: '#4189BA', opacity: 0.8 },
    }
    expect(
      sourceRenderAppearance({ ...base, materialFromParent: true, placements: [outside] }),
    ).toMatchObject({ kind: 'surface', color: '#4189BA', opacity: 0.8 })
    expect(
      sourceRenderAppearance({
        ...base,
        materialFromParent: true,
        placements: [outside, { id: 'child', definitionId: 'block' }],
      }),
    ).toBeUndefined()
  })
})
