import { describe, expect, it } from 'vitest'
import { applyOps, designFrom, evaluationOrder, parseDesignDocument } from './design'
import { importRoleOf, type NodeOf, NodeSchema } from './nodes'

const source = {
  id: 'original',
  kind: 'meshBody',
  source: { type: 'asset', assetId: 'rhino-mesh', rhinoLayer: 'Imported::Stones' },
  importRole: 'stone',
  keepSourcePlacement: true,
} as const
const gem = {
  id: 'confirmed',
  kind: 'gem',
  importSourceId: source.id,
  importSourceFit: { cut: 'emerald', width: 4, length: 6, depth: 3 },
  cut: 'emerald',
  width: 4,
  lw: 1.5,
} as const

describe('confirmed Rhino imports', () => {
  it('keeps an alloy chosen before import roles were available', () => {
    const legacy = NodeSchema.parse({
      ...source,
      importRole: undefined,
      material: 'au18k-white',
    }) as NodeOf<'meshBody'>
    expect(importRoleOf(legacy)).toBe('metal')
    expect(importRoleOf({ ...legacy, importRole: 'reference' })).toBe('reference')
  })

  it('round-trips the source role and fit, and builds the source before its gem', () => {
    const design = designFrom('other', [gem, source])
    const read = parseDesignDocument(JSON.parse(JSON.stringify(design)))
    expect(read.nodes.original).toMatchObject({ importRole: 'stone' })
    expect(read.nodes.confirmed).toMatchObject({
      importSourceId: 'original',
      importSourceFit: { cut: 'emerald', width: 4, length: 6, depth: 3 },
    })
    expect(evaluationOrder(read)).toEqual(['original', 'confirmed'])
  })

  it('rejects a source with the wrong role or a second confirmation', () => {
    expect(() => designFrom('other', [gem, { ...source, importRole: 'metal' }])).toThrow(
      /confirmed.+original/,
    )
    expect(() => designFrom('other', [source, gem, { ...gem, id: 'second' }])).toThrow(
      /second.+original/,
    )
  })

  it('restores the original role and removes the linked gem when undoing confirmation', () => {
    const design = designFrom('other', [{ ...source, importRole: 'unassigned' }])
    const confirmed = applyOps(design, [
      { t: 'update', id: source.id, patch: { importRole: 'stone' } },
      { t: 'add', node: gem },
    ])
    expect(applyOps(confirmed.design, confirmed.inverse).design).toEqual(design)
  })
})
