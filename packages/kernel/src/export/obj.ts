/**
 * Wavefront OBJ for sculpting and rendering tools (ZBrush, Blender): one named object and group
 * per part and stone, welded triangles, no normals (those tools rebuild them), millimetres.
 */
import { defineExporter } from '../core'
import { MM_NOTE, type MeshObject, sceneObjects } from './meshes'

/** OBJ names may not contain whitespace in every reader. */
const objName = (name: string) => name.replace(/\s+/g, '_')

/** Shortest decimal that round-trips a float32 coordinate at 0.1 µm. */
const num = (v: number) => (Math.round(v * 1e4) / 1e4).toString()

export function writeObj(objects: readonly MeshObject[]): Uint8Array {
  const lines: string[] = ['# Pave OBJ export', '# units: millimetres']
  let base = 1
  for (const o of objects) {
    const name = objName(o.name)
    lines.push(`o ${name}`, `g ${name}`)
    if (o.kind === 'metal') lines.push(`# material ${o.material} ${o.finish} plating ${o.plating}`)
    else lines.push(`# stone ${o.stone.stone} ${o.stone.cut} ${o.stone.carat.toFixed(3)} ct`)
    const p = o.positions
    for (let i = 0; i < p.length; i += 3) lines.push(`v ${num(p[i]!)} ${num(p[i + 1]!)} ${num(p[i + 2]!)}`)
    for (let t = 0; t < o.indices.length; t += 3)
      lines.push(`f ${o.indices[t]! + base} ${o.indices[t + 1]! + base} ${o.indices[t + 2]! + base}`)
    base += p.length / 3
  }
  return new TextEncoder().encode(`${lines.join('\n')}\n`)
}

export const obj = defineExporter({
  format: 'obj',
  detail: 'production',
  run(scene, options) {
    const objects = sceneObjects(scene, { stones: options.stones ?? true, ...(options.only && { only: options.only }) })
    return {
      bytes: writeObj(objects),
      mime: 'model/obj',
      extension: 'obj',
      notes: [MM_NOTE, 'One object/group per metal part and per stone; materials are named in comments (no .mtl).'],
    }
  },
})
