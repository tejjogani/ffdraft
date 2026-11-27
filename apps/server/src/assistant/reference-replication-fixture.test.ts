import { expect, it } from 'vitest'
import { referenceOverlap } from './reference-replication-fixture'

it('scores shared foreground over the union at the same camera', () => {
  const bg = [244, 243, 240, 255]
  const fg = [110, 120, 130, 255]
  const truth = Uint8Array.from([...bg, ...fg, ...fg, ...bg])
  const shifted = Uint8Array.from([...bg, ...bg, ...fg, ...fg])
  expect(referenceOverlap(truth, truth)).toBe(1)
  expect(referenceOverlap(truth, shifted)).toBeCloseTo(1 / 3)
  expect(referenceOverlap(Uint8Array.from(bg), Uint8Array.from(bg))).toBe(0)
})
