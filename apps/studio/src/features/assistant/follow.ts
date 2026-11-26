/** A project opens its own latest conversation or a fresh scoped draft. */
export function followTarget(o: {
  activeThreadId: string | null
  threadPieceId: string | null
  pieceId: string
  latestThreadId: string | null
}): { open: string | null } | null {
  if (!o.activeThreadId) return o.latestThreadId ? { open: o.latestThreadId } : null
  if (o.threadPieceId === o.pieceId) return null
  return { open: o.latestThreadId }
}
