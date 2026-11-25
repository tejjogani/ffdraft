import { beforeEach, describe, expect, it } from 'vitest'
import { menuSelection, useWorkspace } from './workspace'

describe('the selection after a right-click', () => {
  it('selects what was clicked when it is not selected', () => {
    expect(menuSelection(['band'], 'halo')).toEqual(['halo'])
    expect(menuSelection([], 'halo')).toEqual(['halo'])
  })

  it('keeps a selection the click is part of, so the menu acts on all of it', () => {
    expect(menuSelection(['halo', 'center'], 'center')).toEqual(['halo', 'center'])
  })

  it('clears it on empty space', () => {
    expect(menuSelection(['halo', 'center'], null)).toEqual([])
  })
})

describe('the selection when features leave the design', () => {
  const ws = useWorkspace.getState
  const left = (...gone: string[]) => ws().retain((id) => !gone.includes(id))
  beforeEach(() => {
    useWorkspace.setState({ pieceId: null })
    ws().open('p1')
  })

  it('drops a feature that an undo (or someone else) removed, keeping the rest', () => {
    ws().select(['band', 'halo'])
    left('halo')
    expect(ws().selection).toEqual(['band'])
  })

  it('forgets the picked stone, the hover and a rename of a removed feature', () => {
    ws().pick({ nodeId: 'row' })
    ws().pick({ nodeId: 'row', stoneId: 'row:3' })
    ws().setHover({ nodeId: 'row', stoneId: 'row:4' })
    ws().setRenaming('row')
    expect(ws().stone).toBe('row:3')
    left('row')
    expect(ws()).toMatchObject({ selection: [], stone: null, hover: null, renaming: null })
  })

  it('changes nothing (not even the state object) while everything still exists', () => {
    ws().pick({ nodeId: 'row' })
    ws().pick({ nodeId: 'row', stoneId: 'row:3' })
    ws().setHover({ nodeId: 'band' })
    const before = ws()
    left('halo')
    expect(ws()).toBe(before)
    expect(ws().stone).toBe('row:3')
  })
})

describe('picking on the model', () => {
  const ws = useWorkspace.getState
  beforeEach(() => {
    useWorkspace.setState({ pieceId: null })
    ws().open('p1')
  })

  it('selects the feature first and a stone of it on the second click', () => {
    ws().pick({ nodeId: 'row', stoneId: 'row:3' })
    expect(ws()).toMatchObject({ selection: ['row'], stone: null })
    ws().pick({ nodeId: 'row', stoneId: 'row:3' })
    expect(ws().stone).toBe('row:3')
    ws().pick({ nodeId: 'band' })
    expect(ws()).toMatchObject({ selection: ['band'], stone: null })
  })

  it('toggles features in and out of the selection with a modifier, and clears on empty space', () => {
    ws().pick({ nodeId: 'band' })
    ws().pick({ nodeId: 'halo' }, true)
    expect(ws().selection).toEqual(['band', 'halo'])
    ws().pick({ nodeId: 'band' }, true)
    expect(ws().selection).toEqual(['halo'])
    ws().pick(null)
    expect(ws().selection).toEqual([])
  })

  it('resets the view state when another piece opens, and only then', () => {
    ws().select(['band'])
    ws().toggleHidden('halo')
    ws().open('p1')
    expect(ws()).toMatchObject({ selection: ['band'], hidden: ['halo'] })
    ws().open('p2')
    expect(ws()).toMatchObject({ selection: [], hidden: [], stone: null, hover: null })
  })

  it('keeps a display mode the designer chose over the software-GPU default', () => {
    useWorkspace.setState({ display: 'rendered', displayChosen: false })
    ws().setDisplay('clay', false)
    expect(ws()).toMatchObject({ display: 'clay', displayChosen: false })
    ws().setDisplay('technical')
    ws().setDisplay('clay', false)
    expect(ws().displayChosen).toBe(true)
  })
})
