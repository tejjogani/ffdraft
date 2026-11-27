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

  it('selects the exact stone on the first click', () => {
    ws().pick({ nodeId: 'row', stoneId: 'row:3' })
    expect(ws()).toMatchObject({ selection: ['row'], stone: 'row:3' })
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

describe('component visibility', () => {
  const ws = useWorkspace.getState
  const a = { nodeId: 'pave', stoneId: 'pave:1' }
  const b = { nodeId: 'pave', stoneId: 'pave:2' }
  beforeEach(() => {
    useWorkspace.setState({ pieceId: null })
    ws().open('one')
  })
  it('updates the exact target when right-clicking a sibling or the parent row', () => {
    ws().pick(a)
    ws().selectForMenu('pave', 'pave:2')
    expect(ws().stone).toBe(b.stoneId)
    ws().selectForMenu('pave')
    expect(ws().stone).toBeNull()
  })
  it('hides just one stone and restores earlier hides after isolating its neighbor', () => {
    ws().toggleTarget(a)
    ws().toggleTarget({ nodeId: 'rail' })
    ws().isolateTargets([b])
    expect(ws()).toMatchObject({ hidden: ['rail'], hiddenStones: ['pave:1'], isolated: [b] })
    ws().exitIsolation()
    expect(ws()).toMatchObject({ hidden: ['rail'], hiddenStones: ['pave:1'], isolated: [] })
    ws().showAll()
    expect(ws()).toMatchObject({ hidden: [], hiddenStones: [], isolated: [] })
  })
  it('reveals an isolated shell when its parent part was hidden, then restores the hide', () => {
    const parent = { nodeId: 'chain', partId: 'chain#metal' }
    const shell = { nodeId: parent.nodeId, partId: parent.partId + '#shell:2' }
    ws().toggleTarget(parent)
    ws().isolateTargets([shell])
    expect(ws().hiddenParts).toEqual([])
    ws().exitIsolation()
    expect(ws().hiddenParts).toEqual([parent.partId])
    ws().toggleTarget(shell)
    expect(ws().hiddenParts).toEqual([])
  })

  it('isolates an explicitly hidden selection and restores the prior view', () => {
    ws().setTargetsHidden([{ nodeId: 'pave' }, a], true)
    ws().isolateTargets([a])
    expect(ws()).toMatchObject({ hidden: [], hiddenStones: [], isolated: [a] })
    ws().exitIsolation()
    expect(ws()).toMatchObject({ hidden: ['pave'], hiddenStones: ['pave:1'] })
  })
  it('drops obsolete metal shell identities when a feature is rebuilt', () => {
    const shell = { nodeId: 'links', partId: 'links#shell:2' }
    ws().toggleTarget(shell)
    ws().pick(shell)
    ws().isolateTargets([shell])
    ws().setHover(shell)
    ws().retain(
      () => true,
      new Set(),
      (partId) => partId !== shell.partId,
    )
    expect(ws()).toMatchObject({
      selection: ['links'],
      part: null,
      hiddenParts: [],
      hover: null,
      isolated: [],
    })
  })

  it('forgets hidden and isolated parts when their node leaves or a project changes', () => {
    const physical = { nodeId: 'pair', partId: 'pair#1' }
    ws().pick(physical)
    expect(ws().part).toBe('pair#1')
    ws().toggleTarget(physical)
    ws().toggleTarget(a)
    ws().isolateTargets([b])
    ws().retain((id) => id !== 'pave')
    expect(ws()).toMatchObject({ isolated: [], hiddenStones: [], hiddenParts: ['pair#1'] })
    ws().open('two')
    expect(ws()).toMatchObject({ hiddenParts: [], isolated: [], part: null })
  })
})

it('opens a mixed Rhino drawing with guides tucked away, and respects showing them for that visit', () => {
  const ws = useWorkspace.getState
  ws().open('import-visit')
  ws().startCurveVisibility(['guide'])
  expect(ws().hidden).toContain('guide')
  ws().toggleHidden('guide')
  ws().startCurveVisibility(['guide'])
  expect(ws().hidden).toEqual([])
  ws().open('other-view')
  expect(ws().hidden).toEqual([])
  ws().startCurveVisibility([])
  expect(ws().hidden).toEqual([])
})
