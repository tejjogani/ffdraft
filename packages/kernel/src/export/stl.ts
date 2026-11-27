/**
 * Binary STL — what a caster prints (docs/research/02-production.md §2): production detail,
 * each alloy fused and split into watertight shells, seats cut, millimetres. Stones are left
 * out unless asked for, and then appended as separate shells flagged as reference geometry.
 */
import { defineExporter } from '../core'
import { writeStl } from '../mesh/stl'
import { MM_NOTE, metalNotes, sceneObjects } from './meshes'

export { writeStl } from '../mesh/stl'

export const stl = defineExporter({
  format: 'stl',
  detail: 'production',
  run(scene, options) {
    const stones = options.stones ?? false
    const objects = sceneObjects(scene, { stones, ...(options.only && { only: options.only }) })
    const notes = [
      MM_NOTE,
      ...metalNotes(scene, objects),
      'STL carries no units, names or colours; use 3MF or 3DM when those matter.',
    ]
    if (stones)
      notes.push('Stones are included as separate reference shells: remove them before printing.')
    return {
      bytes: writeStl(
        objects,
        `Pave STL, millimetres, ${stones ? 'metal + REFERENCE stones' : 'metal only'}`,
      ),
      mime: 'model/stl',
      extension: 'stl',
      notes,
    }
  },
})
