/**
 * Whole-piece manufacturability checks: everything that needs the kernel's exact solids,
 * cutters, stones and frames together (a scene), not one node at a time. Generic wall-thickness
 * analysis of meshes lives in @pave/production. Checks that need fused metal run only on
 * production scenes; the size and bail rules run at any detail.
 */
import type { Scene } from '../core'
import type { Diagnostic } from '../types'
import { chainChecks } from './chains'
import { connectivityChecks } from './connectivity'
import { cutChecks } from './cuts'
import { groupChecks } from './groups'
import { limitChecks } from './limits'
import { DEFAULT_PROFILE, type DfmProfile } from './profile'
import { sizeChecks } from './sizes'
import { stoneChecks } from './stones'

export { DEFAULT_PROFILE, type DfmProfile, profileWith } from './profile'

const CHECKS: Record<string, (scene: Scene, profile: DfmProfile) => Diagnostic[]> = {
  sizes: sizeChecks,
  chains: chainChecks,
  groups: groupChecks,
  connectivity: connectivityChecks,
  cuts: cutChecks,
  stones: stoneChecks,
  limits: limitChecks,
}

/**
 * Every check, each on its own: geometry one check cannot handle (a degenerate mesh, a failed
 * boolean) costs that check, reported as `dfm.unavailable`, never the others' findings.
 */
export function manufacturabilityDiagnostics(
  scene: Scene,
  profile: DfmProfile = DEFAULT_PROFILE,
): Diagnostic[] {
  return Object.entries(CHECKS).flatMap(([name, check]) => {
    try {
      return check(scene, profile)
    } catch (error) {
      return [
        {
          level: 'warning' as const,
          code: 'dfm.unavailable',
          message: `The ${name} check could not run on this piece: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]
    }
  })
}
