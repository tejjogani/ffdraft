import { describe, expect, it } from 'vitest'
import { cornerPoint, cornersFor, handleOffsets, moveHandles, zeroOffsets } from './handles'

const bounds = { min: [10, 20, 30], max: [13, 25, 38] } as const

describe('mount cage handles', () => {
  it('numbers corners with X, Y and Z bits, measured in project millimetres', () => {
    expect(cornerPoint(bounds, 0)).toEqual([10, 20, 30])
    expect(cornerPoint(bounds, 1)).toEqual([13, 20, 30])
    expect(cornerPoint(bounds, 2)).toEqual([10, 25, 30])
    expect(cornerPoint(bounds, 4)).toEqual([10, 20, 38])
    expect(cornerPoint(bounds, 7)).toEqual([13, 25, 38])
  })

  it('selects the four corners of a face or all eight corners', () => {
    expect(cornersFor({ kind: 'face', index: 4 })).toEqual([0, 1, 2, 3])
    expect(cornersFor({ kind: 'face', index: 3 })).toEqual([2, 3, 6, 7])
    expect(cornersFor({ kind: 'corner', index: 6 })).toEqual([6])
    expect(cornersFor({ kind: 'all' })).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('reports only axis offsets shared by every selected corner', () => {
    const corner = moveHandles(zeroOffsets(), { kind: 'corner', index: 7 }, [0, 0.2, 0])
    const face = moveHandles(corner, { kind: 'face', index: 5 }, [1, 0, 0.25])
    expect(handleOffsets(face, { kind: 'corner', index: 7 })).toEqual([1, 0.2, 0.25])
    expect(handleOffsets(face, { kind: 'face', index: 5 })).toEqual([1, null, 0.25])
  })

  it('adds an increment only to selected corners, retaining prior edits and their relative positions', () => {
    const zero = zeroOffsets()
    const corner = moveHandles(zero, { kind: 'corner', index: 7 }, [0, 0.2, 0.5])
    const face = moveHandles(corner, { kind: 'face', index: 5 }, [1, 0, 0.25])
    expect(zero[7]).toEqual([0, 0, 0])
    expect(face[0]).toEqual([0, 0, 0])
    expect(face[5]).toEqual([1, 0, 0.25])
    expect(face[7]).toEqual([1, 0.2, 0.75])
  })
})
