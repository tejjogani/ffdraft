/**
 * The feature registry: one builder per schema node kind. A kind that is not listed here is
 * reported as `feature.unsupported` and left out of `Kernel.kinds`.
 *
 * To add a feature, create `features/<kind>.ts` exporting `defineFeature('<kind>', …)` (see
 * ../core.ts for the contract) and add it to this list.
 */
import type { AnyFeature } from '../core'
import { gem } from './gem'
import { meshBody } from './meshBody'
import { primitive } from './primitive'
import { ringShank } from './ringShank'

export const FEATURES: readonly AnyFeature[] = [ringShank, gem, primitive, meshBody]
