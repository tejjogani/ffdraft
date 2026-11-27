/**
 * The feature registry: one builder per schema node kind. A kind that is not listed here is
 * reported as `feature.unsupported` and left out of `Kernel.kinds`.
 *
 * To add a feature, create `features/<kind>.ts` exporting `defineFeature('<kind>', …)` (see
 * ../core.ts for the contract) and add it to this list.
 */
import type { AnyFeature } from '../core'
import { bail } from './bail'
import { booleanFeature } from './boolean'
import { chain } from './chain'
import { curve, nurbsCurve } from './curve'
import { engraving } from './engraving'
import { finding } from './finding'
import { gem } from './gem'
import { gemRow } from './gemRow'
import { group } from './group'
import { halo } from './halo'
import { loft } from './loft'
import { meshBody } from './meshBody'
import { pattern } from './pattern'
import { pave } from './pave'
import { pipe } from './pipe'
import { primitive } from './primitive'
import { railSweep } from './railSweep'
import { relief } from './relief'
import { revolve } from './revolve'
import { ringShank } from './ringShank'
import { setting } from './setting'
import { thickenSurface } from './thickenSurface'
import { vectorBody } from './vectorBody'

export const FEATURES: readonly AnyFeature[] = [
  ringShank,
  gem,
  setting,
  halo,
  gemRow,
  revolve,
  loft,
  railSweep,
  thickenSurface,
  pipe,
  engraving,
  booleanFeature,
  bail,
  primitive,
  meshBody,
  chain,
  pave,
  vectorBody,
  relief,
  finding,
  pattern,
  group,
  curve,
  nurbsCurve,
]
