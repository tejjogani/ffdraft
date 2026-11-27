import { expect, it } from 'vitest'
import { emptyDesign, validateDesign } from './design'
import { NodeSchema, nodeRefs } from './nodes'

it('links ordered profiles and rails and keeps material and shape defaults', () => {
  const loft = NodeSchema.parse({ kind: 'loft', id: 'head', sections: ['lower', 'upper'] })
  expect(loft).toMatchObject({ ruled: false, capped: true, material: 'au18k-yellow' })
  expect(nodeRefs(loft)).toEqual(['lower', 'upper'])
  const sweep = NodeSchema.parse({
    kind: 'railSweep',
    id: 'arm',
    sections: ['start'],
    rails: ['left', 'right'],
  })
  expect(new Set(nodeRefs(sweep))).toEqual(new Set(['left', 'right', 'start']))
  const design = emptyDesign()
  design.order = ['arm', 'start']
  design.nodes = { arm: sweep, start: NodeSchema.parse({ kind: 'primitive', id: 'start' }) }
  expect(
    validateDesign(design).some((i) => i.message.includes('curve') && i.message.includes('start')),
  ).toBe(true)
})

it.each([
  { kind: 'loft', sections: ['only'] },
  { kind: 'loft', sections: ['a', 'a'] },
  { kind: 'railSweep', sections: [], rails: ['a'] },
  { kind: 'railSweep', sections: ['a'], rails: ['a'] },
  { kind: 'railSweep', sections: ['a'], rails: ['b', 'c', 'd'] },
])('rejects ambiguous or incomplete $kind inputs', (node) => {
  expect(NodeSchema.safeParse({ id: 'out', ...node }).success).toBe(false)
})
