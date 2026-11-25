/**
 * Which conversation the dock shows when a piece opens (also on the first load of the page): the
 * piece's latest, unless the one shown is already about this piece, or about no piece at all (a
 * chat started on Home that is making this piece). With nothing open, the latest is shown, so a
 * job that stopped with an error opens on its conversation, error and Retry included.
 */
export function followTarget(o: {
  activeThreadId: string | null
  threadPieceId: string | null
  pieceId: string
  latestThreadId: string | null
}): { open: string | null } | null {
  if (!o.activeThreadId) return o.latestThreadId ? { open: o.latestThreadId } : null
  if (!o.threadPieceId || o.threadPieceId === o.pieceId) return null
  return { open: o.latestThreadId }
}
