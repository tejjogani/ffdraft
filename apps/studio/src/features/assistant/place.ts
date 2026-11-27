/** Where a studio path is, in the terms `ui.context` and `ui.navigate` use. Pure, for tests. */
import { PIECE_TABS, type SavedScene } from '@pave/schema'

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

/** The Render tab selects the first saved view unless it links directly to another one. */
export function renderShotId(
  { pieceId, tab }: ReturnType<typeof placeOf>,
  requested: unknown,
  saved: readonly Pick<SavedScene, 'id' | 'pieceId'>[],
): string | null {
  if (!pieceId || tab !== 'render') return null
  const selected = typeof requested === 'string' && requested.length > 0 ? requested : null
  return (
    saved.find((shot) => shot.pieceId === pieceId && (!selected || shot.id === selected))?.id ??
    null
  )
}
