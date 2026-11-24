import { buildDesign, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { readableMessage, toIssues } from './issues'

const halo = buildDesign(TEMPLATES.find((t) => t.id === 'halo')!.spec)
const design = {
  ...halo,
  nodes: { ...halo.nodes, halo_xpc5mp: { ...halo.nodes.row!, id: 'halo_xpc5mp', name: undefined } },
} as typeof halo

describe('checks wording', () => {
  it('names features instead of ids and drops the worst-instance detail', () => {
    expect(readableMessage('Stones center:0 and row:7 overlap (worst: halo:1)', design)).toBe(
      'Stones Centre stone, stone 1 and Shoulder stones, stone 8 overlap',
    )
    expect(readableMessage('"halo_xpc5mp" does not touch "Band"', design)).toBe(
      '"Stone row" does not touch "Band"',
    )
  })

  it('leaves ordinary words alone even when a node has that id', () => {
    expect(readableMessage('The band is thinner than 1.2 mm', design)).toBe(
      'The band is thinner than 1.2 mm',
    )
  })

  it('counts one finding per feature and puts problems first', () => {
    const d = (level: 'error' | 'warning', nodeId: string) => ({
      level,
      code: 'x',
      message: '',
      nodeId,
    })
    const issues = toIssues([d('warning', 'a'), d('error', 'b'), d('error', 'b')])
    expect(issues.map((i) => [i.d.nodeId, i.count])).toEqual([
      ['b', 2],
      ['a', 1],
    ])
  })
})
