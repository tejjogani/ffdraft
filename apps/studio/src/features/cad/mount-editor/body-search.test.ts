import { NodeSchema } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { isImportedMesh } from '../mesh-edit/model'
import { filterMountBodies } from './body-search'

function body(id: string, name?: string, rhinoLayer?: string, groups?: string[]) {
  const node = NodeSchema.parse({
    kind: 'meshBody',
    id,
    name,
    keepSourcePlacement: true,
    source: {
      type: 'asset',
      assetId: `${id}-asset`,
      rhinoLayer,
      rhinoContext: groups && {
        groups: groups.map((name) => ({ id: name, name })),
        placements: [],
      },
    },
  })
  if (!isImportedMesh(node)) throw new Error('Expected an imported body')
  return node
}

describe('mount body search', () => {
  const bodies = [
    body('band', 'Ring shank'),
    body('member-a', 'Right claw', 'Halo rails', ['Group100']),
    body('member-b', 'Left claw', 'Prongs', ['Group51', 'Group100']),
    body('member-c', undefined, 'Shared parts', ['Group90']),
  ]

  it('matches name, source layer or any group case-insensitively without reordering', () => {
    const ids = (query: string) => filterMountBodies(bodies, query).map((body) => body.id)
    expect(ids(' Group100 ')).toEqual(['member-a', 'member-b'])
    expect(ids('halo rails')).toEqual(['member-a'])
    expect(ids('right group100')).toEqual(['member-a'])
    expect(ids('ring SHANK')).toEqual(['band'])
    expect(ids('sculpted')).toEqual(['member-c'])
    expect(ids('no match')).toEqual([])
    expect(ids(' ')).toEqual(bodies.map((body) => body.id))
  })
})
