import { describe, expect, it } from 'vitest'
import { menuSelection } from './workspace'

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
