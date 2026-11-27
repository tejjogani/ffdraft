import { sampleNurbs } from '@pave/schema'
import { defineFeature } from '../core'

/** The evaluator assembles polylines independently of solid bodies and stones. */
export const curve = defineFeature('curve', () => ({}))

export const nurbsCurve = defineFeature('nurbsCurve', (node) => ({ data: sampleNurbs(node) }))
