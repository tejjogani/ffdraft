/**
 * Built-in sculpted models for `meshBody`, generated procedurally (no binary assets to ship or
 * license). Each generator returns a closed Manifold in millimetres, Z up, facing −Y; meshBody
 * scales and places it like an imported mesh. The caller owns the result.
 */
import type { NodeOf } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import { trophy } from './trophy'

export type BuiltinName = Extract<NodeOf<'meshBody'>['source'], { type: 'builtin' }>['name']

export const BUILTINS: Record<BuiltinName, () => Manifold> = { trophy } as Record<BuiltinName, () => Manifold>
