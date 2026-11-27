import { describe, expect, it } from 'vitest'
import { applyOps, designFrom } from './design'
import { replaceStone } from './intents'
import { mountCageForPart, mountCageIsAffine, mountCagePoint } from './mount-cage'
import type { MountCage } from './nodes'

const cage: MountCage = {
  min: [0, 0, 0],
  max: [4, 2, 2],
  offsets: [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 1],
  ],
}

describe('custom mount fields', () => {
  it('accepts a cage on a measured STL and rejects an unconfirmed Rhino part', () => {
    const design = designFrom('ring', [
      {
        id: 'stl',
        kind: 'meshBody',
        source: { type: 'asset', assetId: 'mesh' },
        keepSourcePlacement: true,
      },
      {
        id: 'rhino',
        kind: 'meshBody',
        source: { type: 'asset', assetId: 'rhinoMesh', nativeAssetId: 'rhino' },
        keepSourcePlacement: true,
      },
    ])
    const edited = applyOps(design, [{ t: 'update', id: 'stl', patch: { mountCage: cage } }]).design
    expect(edited.nodes.stl).toHaveProperty('mountCage', cage)
    expect(() =>
      applyOps(design, [{ t: 'update', id: 'rhino', patch: { mountCage: cage } }]),
    ).toThrow(/confirmed as metal/)
  })

  it('validates the link to the confirmed source stone', () => {
    const design = designFrom('ring', [
      {
        id: 'metal',
        kind: 'meshBody',
        source: { type: 'asset', assetId: 'mesh' },
        keepSourcePlacement: true,
      },
      { id: 'loose', kind: 'gem' },
    ])
    expect(() =>
      applyOps(design, [
        {
          t: 'update',
          id: 'metal',
          patch: {
            mountFit: {
              gem: 'loose',
              base: { width: 3, length: 4, depth: 2 },
              frame: { position: [0, 0, 0], rotation: [0, 0, 0] },
            },
          },
        },
      ]),
    ).toThrow(/confirmed imported stone/)
  })

  it('uses the same continuous field at a point but separate affine gradients for by-part fitting', () => {
    const raw = { ...cage, mode: 'byPart' as const }
    const left = mountCageForPart(raw, [1, 1, 1])
    const right = mountCageForPart(raw, [3, 1, 1])
    expect(mountCageIsAffine(cage)).toBe(false)
    expect(mountCageIsAffine(left)).toBe(true)
    expect(mountCageIsAffine(right)).toBe(true)
    expect(mountCagePoint(cage, [3, 1, 1])).toEqual([3, 1, 1.1875])
    expect(mountCagePoint(left, [1, 1, 1])).toEqual([1, 1, 1.0625])
    expect(mountCagePoint(right, [3, 1, 1])).toEqual([3, 1, 1.1875])
    expect(mountCagePoint(left, [2, 2, 2])).toEqual([2, 2, 2.25])
    expect(mountCagePoint(right, [2, 2, 2])).toEqual([2, 2, 2.5])
  })
})

it('reports the handmade members in the size preview and rejects a group that moves their stone separately', () => {
  const base = { width: 3, length: 3, depth: 2 }
  const frame = { position: [0, 0, 0], rotation: [0, 0, 0] } as const
  const design = designFrom('ring', [
    {
      kind: 'meshBody',
      id: 'source',
      source: { type: 'asset', assetId: 's', rhinoLayer: 'Gem' },
      keepSourcePlacement: true,
      importRole: 'stone',
    },
    {
      kind: 'gem',
      id: 'diamond',
      width: 3,
      placement: { type: 'free' },
      importSourceId: 'source',
      importSourceFit: { ...base, cut: 'round' },
    },
    ...['rail', 'claw'].map((id) => ({
      kind: 'meshBody' as const,
      id,
      source: { type: 'asset' as const, assetId: id },
      keepSourcePlacement: true,
      mountFit: {
        gem: 'diamond',
        base,
        frame: {
          position: [...frame.position] as [number, number, number],
          rotation: [...frame.rotation] as [number, number, number],
        },
      },
    })),
  ])
  const preview = replaceStone(design, { nodeId: 'diamond' }, { widthMm: 3.25 })
  expect(preview.notes.join(' ')).toContain('2 handmade mount parts follow')
  expect(() =>
    applyOps(design, [{ t: 'add', node: { kind: 'group', id: 'group', children: ['diamond'] } }]),
  ).toThrow(/independent stone/)
  expect(() =>
    applyOps(design, [
      {
        t: 'update',
        id: 'rail',
        patch: { mountFit: { gem: 'diamond', base: { ...base, width: 8 }, frame } },
      },
    ]),
  ).toThrow(/original stone measurements/)
})
