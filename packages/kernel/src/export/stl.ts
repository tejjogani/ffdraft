/**
 * Binary STL — what a caster prints (docs/research/02-production.md §2): production detail,
 * each alloy fused and split into watertight shells, seats cut, millimetres. Stones are left
 * out unless asked for, and then appended as separate shells flagged as reference geometry.
 */
import { defineExporter } from '../core'
import { MM_NOTE, type MeshObject, sceneObjects } from './meshes'

const HEADER_BYTES = 80
const TRIANGLE_BYTES = 50

/** Writes triangles with facet normals from their winding (STL readers ignore stored ones anyway). */
export function writeStl(objects: readonly MeshObject[], header: string): Uint8Array {
  const count = objects.reduce((n, o) => n + o.indices.length / 3, 0)
  const bytes = new Uint8Array(HEADER_BYTES + 4 + count * TRIANGLE_BYTES)
  bytes.set(new TextEncoder().encode(header.slice(0, HEADER_BYTES)))
  const view = new DataView(bytes.buffer)
  view.setUint32(HEADER_BYTES, count, true)
  let at = HEADER_BYTES + 4
  for (const { positions: p, indices } of objects)
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t]! * 3
      const b = indices[t + 1]! * 3
      const c = indices[t + 2]! * 3
      const ux = p[b]! - p[a]!
      const uy = p[b + 1]! - p[a + 1]!
      const uz = p[b + 2]! - p[a + 2]!
      const vx = p[c]! - p[a]!
      const vy = p[c + 1]! - p[a + 1]!
      const vz = p[c + 2]! - p[a + 2]!
      let nx = uy * vz - uz * vy
      let ny = uz * vx - ux * vz
      let nz = ux * vy - uy * vx
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l
      ny /= l
      nz /= l
      for (const v of [nx, ny, nz, p[a]!, p[a + 1]!, p[a + 2]!, p[b]!, p[b + 1]!, p[b + 2]!, p[c]!, p[c + 1]!, p[c + 2]!]) {
        view.setFloat32(at, v, true)
        at += 4
      }
      at += 2 // attribute byte count
    }
  return bytes
}

export const stl = defineExporter({
  format: 'stl',
  detail: 'production',
  run(scene, options) {
    const stones = options.stones ?? false
    const objects = sceneObjects(scene, { stones, ...(options.only && { only: options.only }) })
    const metal = objects.filter((o) => o.kind === 'metal')
    const notes = [
      MM_NOTE,
      `${metal.length} watertight metal shell${metal.length === 1 ? '' : 's'}, seats and engravings cut; nominal size — the caster applies shrinkage.`,
      'STL carries no units, names or colours; use 3MF or 3DM when those matter.',
    ]
    if (stones) notes.push('Stones are included as separate reference shells: remove them before printing.')
    return {
      bytes: writeStl(objects, `Pave STL, millimetres, ${stones ? 'metal + REFERENCE stones' : 'metal only'}`),
      mime: 'model/stl',
      extension: 'stl',
      notes,
    }
  },
})
