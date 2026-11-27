import { expect, it } from 'vitest'
import { applyOps, designFrom } from './design'
import type { NodeInputOf } from './nodes'

const section: NodeInputOf<'curve'> = {
  id: 'section',
  kind: 'curve',
  plane: 'right',
  closed: true,
  points: [
    { id: 'a', u: -2, v: -1 },
    { id: 'b', u: 2, v: -1 },
    { id: 'c', u: 2, v: 1 },
    { id: 'd', u: -2, v: 1 },
  ],
}
const band: NodeInputOf<'revolve'> = {
  id: 'band',
  kind: 'revolve',
  curve: 'section',
  size: { system: 'us', value: 6 },
}

it.each([
  [{ angle: 180 }, /360/],
  [{ axis: 'vertical' }, /axis/],
  [{ axisOffset: 0 }, /axis/],
  [{ curve: undefined, profile: 'M 1 1 L 2 1 L 2 3 Z' }, /construction curve/],
  [{ size: { system: 'mm', value: 0 } }, /positive inner diameter/],
  [{ transform: { scale: 2 } }, /scal/],
] as const)('rejects incompatible size-driven revolve options %j', (patch, message) => {
  expect(() => designFrom('ring', [section, { ...band, ...patch }])).toThrow(message)
})

it.each([
  [{ plane: 'front' }, /Top or Right/],
  [{ planeOffset: 3 }, /plane position/i],
  [{ closed: false }, /closed construction curve/i],
  [
    { points: [section.points[0]!, section.points[2]!, section.points[1]!, section.points[3]!] },
    /cross/i,
  ],
] as const)('rejects an incompatible source edit %j', (patch, message) => {
  const design = designFrom('ring', [section, band])
  expect(() => applyOps(design, [{ t: 'update', id: 'section', patch }])).toThrow(message)
})
