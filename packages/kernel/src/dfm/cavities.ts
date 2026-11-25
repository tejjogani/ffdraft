/**
 * Sealed voids inside a casting. Investment cannot fill a void with no way out, and the metal
 * poured around it traps the gas: the casting fails or comes out porous. Production keeps the
 * void in the casting (so its weight and its file stay true to the design); this says so.
 */
import type { Scene } from '../core'
import type { Diagnostic } from '../types'

const mm = (v: number) => v.toFixed(1)

export function cavityChecks(scene: Scene): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const { part, cavities } of scene.parts)
    for (const { box, volume } of cavities ?? []) {
      const at = [0, 1, 2].map((k) => mm((box.min[k]! + box.max[k]!) / 2)).join(', ')
      out.push({
        level: 'warning',
        code: 'metal.sealedCavity',
        nodeId: part.nodeId,
        message: `“${part.name}” has a sealed cavity of ${mm(volume)} mm³ around (${at}) mm. A sealed cavity cannot be invested or cast: add a vent, a hole of at least 1 mm from it to the outside.`,
        value: volume,
      })
    }
  return out
}
