import { describe, expect, it } from 'vitest'
import { placeOf, renderShotId, tabPath } from './place'

describe('placeOf', () => {
  it('reads the piece and its tab, the overview being the piece’s own page', () => {
    expect(placeOf('/pieces/pc_1')).toEqual({ pieceId: 'pc_1', tab: 'overview', boardId: null })
    expect(placeOf('/pieces/pc_1/design')).toEqual({
      pieceId: 'pc_1',
      tab: 'design',
      boardId: null,
    })
    // The Design stage's page is not a tab the assistant can name.
    expect(placeOf('/pieces/pc_1/directions').tab).toBeNull()
  })

  it('reads a board, and nothing elsewhere', () => {
    expect(placeOf('/moodboards/bd_9')).toEqual({ pieceId: null, tab: null, boardId: 'bd_9' })
    expect(placeOf('/settings/ai')).toEqual({ pieceId: null, tab: null, boardId: null })
  })

  it('round-trips a tab through its path', () => {
    for (const tab of ['overview', 'design', 'render', 'history'] as const)
      expect(placeOf(`/pieces/p${tabPath(tab)}`).tab).toBe(tab)
  })
})

it('resolves the selected saved Render shot by project and ID as the view changes', () => {
  const first = { id: 'scn_1', pieceId: 'pc_1' }
  const second = { id: 'scn_2', pieceId: 'pc_1' }
  const foreign = { id: 'scn_3', pieceId: 'pc_2' }
  const saved = [first, second, foreign]
  const render = placeOf('/pieces/pc_1/render')
  expect(renderShotId(render, undefined, saved)).toBe(first.id)
  expect(renderShotId(render, second.id, saved)).toBe(second.id)
  expect(renderShotId(render, first.id, saved)).toBe(first.id)
  expect(renderShotId(render, foreign.id, saved)).toBeNull()
  expect(renderShotId(render, 'scn_removed', saved)).toBeNull()
  expect(renderShotId(render, undefined, [])).toBeNull()
  expect(renderShotId(placeOf('/pieces/pc_1/design'), second.id, saved)).toBeNull()
})
