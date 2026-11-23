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
import { type DfmProfile, DEFAULT_PROFILE } from './profile'
import { sizeChecks } from './sizes'
import { limitChecks } from './limits'
import { stoneChecks } from './stones'

export { type DfmProfile, DEFAULT_PROFILE, profileWith } from './profile'

const CHECKS = [sizeChecks, chainChecks, connectivityChecks, cutChecks, stoneChecks, limitChecks] as const

export function manufacturabilityDiagnostics(scene: Scene, profile: DfmProfile = DEFAULT_PROFILE): Diagnostic[] {
  return CHECKS.flatMap((check) => check(scene, profile))
}
