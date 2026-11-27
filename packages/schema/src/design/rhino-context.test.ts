import { expect, it } from 'vitest'
import { RhinoContext } from './rhino-context'

it('round-trips optional source appearances on a member and its placements', () => {
  const input = {
    groups: [],
    placements: [{ id: 'a', definitionId: 'b', materialAppearance: { opacity: 0.4 } }],
    materialAppearance: { color: '#012abc' },
  }
  expect(RhinoContext.parse(input)).toEqual(input)
  expect(RhinoContext.safeParse({ ...input, materialAppearance: { opacity: 1.1 } }).success).toBe(
    false,
  )
  expect(RhinoContext.safeParse({ ...input, materialAppearance: { color: '#123' } }).success).toBe(
    false,
  )
  expect(RhinoContext.parse({ groups: [], placements: [], material: 'Legacy name' })).toEqual({
    groups: [],
    placements: [],
    material: 'Legacy name',
  })
})
