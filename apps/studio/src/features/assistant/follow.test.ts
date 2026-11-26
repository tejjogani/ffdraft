import { describe, expect, it } from 'vitest'
import { followTarget } from './follow'

describe('the dock follows the piece', () => {
  it('opens the piece’s latest conversation when nothing is open, on first load too', () => {
    expect(
      followTarget({
        activeThreadId: null,
        threadPieceId: null,
        pieceId: 'p1',
        latestThreadId: 't9',
      }),
    ).toEqual({ open: 't9' })
    expect(
      followTarget({
        activeThreadId: null,
        threadPieceId: null,
        pieceId: 'p1',
        latestThreadId: null,
      }),
    ).toBeNull()
  })

  it('keeps this piece’s conversation and switches to it from unscoped and other project threads', () => {
    expect(
      followTarget({
        activeThreadId: 't1',
        threadPieceId: 'p1',
        pieceId: 'p1',
        latestThreadId: 't9',
      }),
    ).toBeNull()
    expect(
      followTarget({
        activeThreadId: 't1',
        threadPieceId: null,
        pieceId: 'p1',
        latestThreadId: 't9',
      }),
    ).toEqual({ open: 't9' })
    expect(
      followTarget({
        activeThreadId: 't1',
        threadPieceId: 'p2',
        pieceId: 'p1',
        latestThreadId: 't9',
      }),
    ).toEqual({ open: 't9' })
  })
})
