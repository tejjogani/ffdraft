import { describe, expect, it } from 'vitest'
import { isViewTargetVisible } from './visibility'

const pave = { nodeId: 'pave' }
const first = { ...pave, stoneId: 'pave:0' }
const second = { ...pave, stoneId: 'pave:1' }
const band = { nodeId: 'band' }
const firstPart = { nodeId: 'pave', partId: 'pave#1' }
const secondPart = { nodeId: 'pave', partId: 'pave#2' }

describe('viewer visibility', () => {
  it('hides a picked stone independently of its setting and neighbours', () => {
    const state = { hidden: [], hiddenStones: ['pave:0'] }
    expect(isViewTargetVisible(state, first)).toBe(false)
    expect(isViewTargetVisible(state, second)).toBe(true)
    expect(isViewTargetVisible(state, pave)).toBe(true)
  })

  it('isolates the exact stone from sibling stones and metal', () => {
    const state = { hidden: [], isolated: [first] }
    expect(isViewTargetVisible(state, first)).toBe(true)
    expect(isViewTargetVisible(state, second)).toBe(false)
    expect(isViewTargetVisible(state, pave)).toBe(false)
    expect(isViewTargetVisible(state, band)).toBe(false)
  })

  it('includes the stones and metal of an isolated node', () => {
    const state = { hidden: [], isolated: [pave] }
    expect(isViewTargetVisible(state, first)).toBe(true)
    expect(isViewTargetVisible(state, pave)).toBe(true)
    expect(isViewTargetVisible(state, band)).toBe(false)
  })

  it('keeps individually hidden stones excluded during isolation', () => {
    expect(
      isViewTargetVisible({ hidden: [], hiddenStones: ['pave:0'], isolated: [pave] }, first),
    ).toBe(false)
  })

  it('keeps hidden nodes and their children excluded during isolation', () => {
    const state = { hidden: ['pave'], isolated: [first, pave, band] }
    expect(isViewTargetVisible(state, first)).toBe(false)
    expect(isViewTargetVisible(state, pave)).toBe(false)
    expect(isViewTargetVisible(state, band)).toBe(true)
  })

  it('hides a single metal part without hiding the owning feature', () => {
    const state = { hidden: [], hiddenParts: ['pave#1'] }
    expect(isViewTargetVisible(state, firstPart)).toBe(false)
    expect(isViewTargetVisible(state, secondPart)).toBe(true)
    expect(isViewTargetVisible(state, first)).toBe(true)
  })

  it('isolates a single metal part without the other parts or stones of its feature', () => {
    const state = { hidden: [], isolated: [firstPart] }
    expect(isViewTargetVisible(state, firstPart)).toBe(true)
    expect(isViewTargetVisible(state, secondPart)).toBe(false)
    expect(isViewTargetVisible(state, first)).toBe(false)
  })

  it('shows everything else after clearing isolation', () => {
    const state = { hidden: ['band'], isolated: [] }
    expect(isViewTargetVisible(state, first)).toBe(true)
    expect(isViewTargetVisible(state, band)).toBe(false)
  })
})
