/**
 * A hidden bail that shows from the front through an opening in the piece (the counter of an A)
 * is not hidden. It is judged here, on the scene, because what covers the bail is the whole
 * piece: on a two-level initial the plug standing in the pierced plate hides it, and the bail's
 * own build sees only the plate it hangs on.
 */
import type { NodeResult, Scene, Solid } from '../core'
import { seenThrough } from '../features/bail'
import type { Diagnostic } from '../types'
import type { DfmProfile } from './profile'

/** Share of the bail's outline that may show before it is reported. */
const SHOWS = 0.02

export function bailChecks(scene: Scene, _profile: DfmProfile): Diagnostic[] {
  const consumed = new Set<string>()
  for (const r of scene.nodes.values()) for (const c of r.consumes) consumed.add(c)
  // The piece as cast: a boolean's operands are inside its result, and the cutter of a pierced
  // plate is not metal at all. Chains hang on afterwards and are not the piece.
  const cast = (r: NodeResult) =>
    r.status === 'ok' && r.node.visible && !consumed.has(r.id) && r.node.kind !== 'chain'
  const out: Diagnostic[] = []
  for (const bail of scene.nodes.values()) {
    const node = bail.node
    if (node.kind !== 'bail' || node.style !== 'hidden' || !node.host || !cast(bail)) continue
    // A bail with nothing to lie in already says so (bail.unsupported); where it would be is moot.
    if (bail.diagnostics.some((d) => d.code === 'bail.unsupported')) continue
    const cover: Solid[] = []
    for (const r of scene.nodes.values())
      if (r !== bail && cast(r)) cover.push(...r.bodies.map((b) => b.solid))
    const solids = bail.bodies.map((b) => b.solid)
    if (solids.length === 0 || cover.length === 0) continue
    const seen = seenThrough(solids, cover)
    if (seen > SHOWS)
      out.push({
        level: 'warning',
        code: 'bail.showsThrough',
        nodeId: bail.id,
        message:
          'The hidden bail shows from the front through an opening in the piece. Make the bail’s opening smaller, or use a bail on top.',
        ...(bail.frames.opening ? { at: [...bail.frames.opening.origin] as [number, number, number] } : {}),
        value: seen,
        limit: SHOWS,
      })
  }
  return out
}
