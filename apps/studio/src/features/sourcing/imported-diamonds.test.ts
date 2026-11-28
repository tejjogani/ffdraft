import { designFrom, type NodeInputOf, type RhinoContext } from '@pave/schema'
import { expect, it } from 'vitest'
import { pendingImportedDiamonds } from './imported-diamonds'

const uuid = 'ef21238a-48f4-4b05-b32f-e203045887c3'
function body(
  id: string,
  material: string,
  overrides: Partial<NodeInputOf<'meshBody'>> = {},
): NodeInputOf<'meshBody'> {
  const context: RhinoContext = {
    groups: [],
    placements: [{ id, definitionId: 'Diamond_Round', material: `/${material}-${uuid}` }],
    materialFromParent: true,
  }
  return {
    id,
    kind: 'meshBody',
    name: 'Diamond_Round',
    keepSourcePlacement: true,
    source: { type: 'asset', assetId: id, rhinoLayer: 'Gem', rhinoContext: context },
    ...overrides,
  }
}

it('counts diamond-labelled occurrences, including legacy imported bodies, separately from confirmed gems', () => {
  const design = designFrom('bracelet', [
    body('emerald', 'Emerald'),
    body('first', 'Diamond'),
    body('second', 'Diamond', { importRole: 'unassigned' }),
    body('already-reviewed', 'Diamond', { importRole: 'reference' }),
    body('metal', 'WhiteMetal'),
    { id: 'confirmed', kind: 'gem', stone: 'diamond' },
    body('hidden', 'Diamond', { visible: false }),
    body('unlabeled', 'Plastic'),
  ])
  expect(pendingImportedDiamonds(design)).toEqual(['first', 'second'])
})

it('recognizes a supplier diamond family without a display material', () => {
  const design = designFrom('bracelet', [
    body('supplier', '', {
      source: {
        type: 'asset',
        assetId: 'supplier',
        rhinoLayer: 'Gem',
        rhinoContext: {
          groups: [],
          placements: [],
          stullerMaterial: { stoneFamily: 'Diamond', stoneColor: 'G-H' },
        },
      },
    }),
  ])
  expect(pendingImportedDiamonds(design)).toEqual(['supplier'])
})

it('gives the supplier family precedence over a diamond display label', () => {
  const design = designFrom('bracelet', [
    body('emerald', '', {
      source: {
        type: 'asset',
        assetId: 'emerald',
        rhinoLayer: 'Gem',
        rhinoContext: {
          material: 'Diamond',
          groups: [],
          placements: [],
          stullerMaterial: { stoneFamily: 'Emerald' },
        },
      },
    }),
  ])
  expect(pendingImportedDiamonds(design)).toEqual([])
})
