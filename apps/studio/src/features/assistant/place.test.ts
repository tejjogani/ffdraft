import { describe, expect, it } from 'vitest'
import { placeOf, tabPath } from './place'

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
