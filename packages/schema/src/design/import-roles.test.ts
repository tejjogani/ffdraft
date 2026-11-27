import { describe, expect, it } from 'vitest'
import { applyOps, designFrom } from './design'
import { reviewRhinoRoles, rhinoRoleCandidates, rhinoRoleLinks } from './import-roles'
import type { NodeInputOf } from './nodes'

const leaf = 'c61570cd-8d71-4324-a06d-fa5759030074'
function body(id: string, appearance = 'Clear'): NodeInputOf<'meshBody'> {
  return {
    id,
    kind: 'meshBody',
    keepSourcePlacement: true,
    source: {
      type: 'asset',
      assetId: id,
      rhinoObjectId: leaf,
      rhinoLayer: 'Template',
      rhinoContext: {
        groups: [],
        placements: [{ id, definitionId: 'block', material: appearance }],
      },
    },
  }
}
const design = () =>
  designFrom('ring', [body('a'), body('b'), body('c', 'Green'), body('head', 'Head')])
const stone = {
  cut: 'round',
  species: 'diamond',
  width: 4,
  length: 4,
  depth: 2.5,
  girdle: [4, 1, 2],
  rotation: [0, 45, 0],
} as const
const choice = () =>
  ({
    sourceId: 'a',
    role: 'stone',
    stone: { ...stone, girdle: [4, 1, 2], rotation: [0, 45, 0] },
    head: { sourceId: 'head', style: 'basket', material: 'ag925-sterling' },
  }) as const
describe('review imported jewelry parts', () => {
  it('keeps differently labelled occurrences outside the suggested selection', () => {
    expect(rhinoRoleCandidates(design(), 'a')).toEqual(['a', 'b'])
  })
  it('keeps supplier families separate when placements share a display material', () => {
    const before = design()
    const changed = applyOps(before, [
      {
        t: 'update',
        id: 'b',
        patch: {
          source: {
            rhinoContext: {
              stullerMaterial: { stoneFamily: 'Tourmaline', stoneColor: 'Green' },
            },
          },
        },
      },
    ]).design
    expect(rhinoRoleCandidates(changed, 'a')).toEqual(['a'])
  })
  it('keeps otherwise identical anonymous solids from two imported archives separate', () => {
    const part = (id: string, archiveId: string): NodeInputOf<'meshBody'> => ({
      id,
      kind: 'meshBody',
      keepSourcePlacement: true,
      source: {
        type: 'asset',
        assetId: id,
        rhinoLayer: 'Parts',
        rhinoContext: { archiveId, topology: 'Brep 12/18/8', placements: [], groups: [] },
      },
    })
    const d = designFrom('ring', [part('a', 'first'), part('b', 'first'), part('c', 'second')])
    expect(rhinoRoleCandidates(d, 'a')).toEqual(['a', 'b'])
  })
  it('makes a separately addressable gem and head, preserves assets, and undoes the full decision', () => {
    const before = design()
    const { design: after, inverse } = applyOps(before, reviewRhinoRoles(before, [choice()]))
    const { gem, setting } = rhinoRoleLinks(after, 'a')
    expect(gem).toMatchObject({
      kind: 'gem',
      stone: 'diamond',
      transform: { position: [4, 1, 2] },
      importSourceFit: { depth: 2.5 },
    })
    expect(setting).toMatchObject({ gem: gem!.id, material: 'ag925-sterling', style: 'basket' })
    expect(after.nodes.b).toEqual(before.nodes.b)
    expect(reviewRhinoRoles(after, [choice()])).toEqual([])
    expect(applyOps(after, inverse).design).toEqual(before)
    const detached = applyOps(
      after,
      reviewRhinoRoles(after, [{ sourceId: 'head', role: 'metal', material: 'ag925-sterling' }]),
    ).design
    expect(rhinoRoleLinks(detached, 'a').gem?.id).toBe(gem!.id)
    expect(detached.nodes[setting!.id]).toBeUndefined()
  })
  it('keeps a transformed group or pattern from producing an extra gem at the source coordinates', () => {
    const before = applyOps(design(), [
      {
        t: 'add',
        node: { id: 'group', kind: 'group', children: ['a'], transform: { position: [5, 0, 0] } },
      },
    ]).design
    expect(() => reviewRhinoRoles(before, [choice()])).toThrow(/group/i)
  })
  it('rejects ambiguous reuse of a physical head and changes that would silently lose a supplier fit', () => {
    const before = design()
    expect(() => reviewRhinoRoles(before, [choice(), { ...choice(), sourceId: 'b' }])).toThrow(
      /once|already|twice/i,
    )
    const after = applyOps(before, reviewRhinoRoles(before, [choice()])).design
    const gemId = rhinoRoleLinks(after, 'a').gem!.id
    const sourced = applyOps(after, [
      { t: 'update', id: gemId, patch: { sourcing: { provider: 'Test', sku: 'Example' } } },
    ]).design
    expect(() => reviewRhinoRoles(sourced, [{ sourceId: 'a', role: 'reference' }])).toThrow(
      /source|supplier|sourcing/i,
    )
  })
})
