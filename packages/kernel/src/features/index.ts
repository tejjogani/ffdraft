/**
 * The feature registry: one builder per schema node kind. A kind that is not listed here is
 * reported as `feature.unsupported` and left out of `Kernel.kinds`.
 *
 * To add a feature, create `features/<kind>.ts` exporting `defineFeature('<kind>', …)` (see
 * ../core.ts for the contract) and add it to this list.
 */
import type { AnyFeature } from '../core'
import { primitive } from './primitive'

export const FEATURES: readonly AnyFeature[] = [primitive]
