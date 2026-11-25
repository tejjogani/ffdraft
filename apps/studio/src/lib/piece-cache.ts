/**
 * The live CAD seam for pieces no design session holds open (the Overview, the job panel, a
 * piece card): a `design.changed` that is exactly the next version of the cached piece is
 * applied to the cache with the same `applyOps` the server used, so an assistant's edit shows
 * at once without a refetch. Anything else (a gap, ops that do not apply) refetches.
 */
import { applyOps, type Op, type Piece, type ServerEvent } from '@pave/schema'

type Changed = Extract<ServerEvent, { type: 'design.changed' }>

/** The patched piece, `unchanged` when the cache already has it, or `refetch`. */
export function patchPiece(piece: Piece, event: Changed): Piece | 'unchanged' | 'refetch' {
  if (event.version <= piece.version) return 'unchanged'
  if (event.version !== piece.version + 1) return 'refetch'
  try {
    const { design } = applyOps(piece.design, event.change.ops as Op[])
    return { ...piece, design, version: event.version }
  } catch {
    return 'refetch'
  }
}
