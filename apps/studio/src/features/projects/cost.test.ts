import type { ProjectCost, StageCost } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { costLines, holds, stageStates, usd } from './cost'

const stage = (over: Partial<StageCost> = {}): StageCost => ({
  aiUsd: 0,
  imageUsd: 0,
  rendersUsed: 0,
  exportsUsed: 0,
  items: 0,
  ...over,
})
const cost = (over: Partial<ProjectCost> = {}): ProjectCost => ({
  pieceId: 'pc_1',
  design: stage(),
  cad: stage(),
  render: stage(),
  otherUsd: 0,
  totalUsd: 0,
  ...over,
})

describe('project costs in words', () => {
  it('formats money the way people read it', () => {
    expect(usd(0)).toBe('$0')
    expect(usd(0.004)).toBe('<$0.01')
    expect(usd(0.125)).toBe('$0.13')
    expect(usd(1234.4)).toBe('$1,234')
  })

  it('says what each stage holds and costs, with the plan’s counts where they belong', () => {
    expect(holds('design', stage({ items: 1 }))).toBe('1 item')
    expect(holds('cad', stage())).toBe('Not started')
    expect(holds('render', stage({ items: 3 }))).toBe('3 takes')
    expect(costLines('design', stage({ aiUsd: 0.2, imageUsd: 0.08 }))).toEqual([
      { label: 'Claude', value: '$0.20' },
      { label: 'Image generations', value: '$0.08' },
    ])
    expect(costLines('cad', stage({ exportsUsed: 2 }))[1]).toEqual({
      label: 'Rhino and STEP exports',
      value: '2',
    })
    expect(costLines('render', stage({ rendersUsed: 4 }))[1]).toEqual({
      label: 'Blender renders',
      value: '4',
    })
  })

  it('marks stage progress for the projects list', () => {
    expect(stageStates({ stage: 'idea', facts: null, boardIds: [] }, undefined)).toEqual({
      design: 'empty',
      cad: 'empty',
      render: 'empty',
    })
    expect(
      stageStates(
        {
          stage: 'render',
          facts: { metalMassG: 3, caratTotal: 1, stoneCount: 1, metal: 'x' },
          boardIds: ['b'],
        },
        cost({ design: stage({ items: 4 }), render: stage({ items: 2 }) }),
      ),
    ).toEqual({ design: 'done', cad: 'done', render: 'done' })
  })
})
