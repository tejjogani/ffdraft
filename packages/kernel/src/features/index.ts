/**
 * The feature registry: one builder per schema node kind. A kind that is not listed here is
 * reported as `feature.unsupported` and left out of `Kernel.kinds`.
 *
 * To add a feature, create `features/<kind>.ts` exporting `defineFeature('<kind>', …)` (see
 * ../core.ts for the contract) and add it to this list.
 */
import type { AnyFeature } from '../core'
import { revolve } from './revolve'
import { pipe } from './pipe'
import { engraving } from './engraving'
import { booleanFeature } from './boolean'
import { bail } from './bail'
import { chain } from './chain'
import { finding } from './finding'
import { gem } from './gem'
import { group } from './group'
import { gemRow } from './gemRow'
import { halo } from './halo'
import { meshBody } from './meshBody'
import { pattern } from './pattern'
import { pave } from './pave'
import { primitive } from './primitive'
import { relief } from './relief'
import { ringShank } from './ringShank'
import { setting } from './setting'
import { vectorBody } from './vectorBody'

export const FEATURES: readonly AnyFeature[] = [ringShank, gem, setting, halo, gemRow, revolve, pipe, engraving, booleanFeature, bail, primitive, meshBody, chain, pave, vectorBody, relief, finding, pattern, group]
