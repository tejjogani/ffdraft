/** Where a studio path is, in the terms `ui.context` and `ui.navigate` use. Pure, for tests. */
import { PIECE_TABS } from '@pave/schema'

export type PieceTab = (typeof PIECE_TABS)[number]

/** A piece tab's path segment: the overview is the piece's own page. */
export const tabPath = (tab: PieceTab) => (tab === 'overview' ? '' : `/${tab}`)

/** The piece, tab and board a studio path shows. */
export function placeOf(pathname: string): {
  pieceId: string | null
  tab: PieceTab | null
  boardId: string | null
} {
  const piece = /^\/pieces\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname)
  if (piece) {
    const segment = piece[2] ?? 'overview'
    const tab = (PIECE_TABS as readonly string[]).includes(segment) ? (segment as PieceTab) : null
    return { pieceId: decodeURIComponent(piece[1]!), tab, boardId: null }
  }
  const board = /^\/moodboards\/([^/]+)\/?$/.exec(pathname)
  return { pieceId: null, tab: null, boardId: board ? decodeURIComponent(board[1]!) : null }
}
