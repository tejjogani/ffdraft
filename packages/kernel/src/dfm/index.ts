/**
 * Whole-piece manufacturability checks: everything that needs the kernel's exact solids,
 * cutters, stones and frames together (a scene), not one node at a time. Generic wall-thickness
 * analysis of meshes lives in @pave/production. Checks that need fused metal run only on
 * production scenes; the size, bail, group, held-stone and weight rules run at any detail.
 */
import type { Scene } from '../core'
import { isRuntimeFault } from '../runtime/index'
import type { Diagnostic } from '../types'
import { bailChecks } from './bails'
import { cavityChecks } from './cavities'
import { chainChecks } from './chains'
import { connectivityChecks } from './connectivity'
import { copyChecks } from './copies'
import { cutChecks } from './cuts'
import { groupChecks } from './groups'
import { heldChecks } from './held'
import { limitChecks } from './limits'
import { DEFAULT_PROFILE, type DfmProfile } from './profile'
import { sizeChecks } from './sizes'
import { stoneChecks } from './stones'
import { wallChecks } from './walls'

export { DEFAULT_PROFILE, type DfmProfile, profileWith } from './profile'

const CHECKS: Record<string, (scene: Scene, profile: DfmProfile) => Diagnostic[]> = {
  sizes: sizeChecks,
  chains: chainChecks,
  bails: bailChecks,
  groups: groupChecks,
  connectivity: connectivityChecks,
  cavities: cavityChecks,
  cuts: cutChecks,
  stones: stoneChecks,
  held: heldChecks,
  limits: limitChecks,
  copies: copyChecks,
  walls: wallChecks,
}

/**
 * Every check, each on its own: geometry one check cannot handle (a degenerate mesh, a failed
 * boolean) costs that check, reported as `dfm.unavailable`, never the others' findings.
 */
export function manufacturabilityDiagnostics(
  scene: Scene,
  profile: DfmProfile = DEFAULT_PROFILE,
): Diagnostic[] {
  return withoutCascades(CHECK_NAMES.flatMap((name) => runCheck(name, scene, profile)))
}

/**
 * One finding per cause. A seat or engraving that cuts a body apart is the finding; the loose
 * pieces it leaves (`metal.separate`, once per piece) are its consequence and are dropped, and
 * a body that is loose for its own reasons is reported once, however many pieces it is in.
 */
export function withoutCascades(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const cutApart = new Set(
    diagnostics
      .filter((d) => d.code === 'seat.through' || d.code === 'engraving.through')
      .flatMap((d) => d.related ?? []),
  )
  const separate = new Set<string>()
  return diagnostics.filter((d) => {
    if (d.code !== 'metal.separate' || d.nodeId === undefined) return true
    if (cutApart.has(d.nodeId) || separate.has(d.nodeId)) return false
    separate.add(d.nodeId)
    return true
  })
}

/** The checks by name, in the order they run: the evaluator yields between them. */
export const CHECK_NAMES = Object.keys(CHECKS)

/** One check, contained: a check that throws reports `dfm.unavailable` (a WASM fault is rethrown). */
export function runCheck(
  name: string,
  scene: Scene,
  profile: DfmProfile = DEFAULT_PROFILE,
): Diagnostic[] {
  try {
    return CHECKS[name]!(scene, profile)
  } catch (error) {
    if (isRuntimeFault(error)) throw error
    return [
      {
        level: 'warning' as const,
        code: 'dfm.unavailable',
        message: `The ${name} check could not run on this piece: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]
  }
}
