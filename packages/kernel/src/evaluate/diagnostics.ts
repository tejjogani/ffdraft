/** Piece-level checks that need more than one node. Per-feature checks live with the feature. */
import type { SceneStone } from '../core'
import type { Diagnostic } from '../types'

export function stoneDiagnostics(_stones: readonly SceneStone[]): Diagnostic[] {
  return []
}
