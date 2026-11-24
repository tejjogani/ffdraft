/**
 * Wavefront OBJ for sculpting and rendering tools (ZBrush, Blender): one named object and group
 * per part and stone, welded triangles, no normals (those tools rebuild them), millimetres.
 */
import { defineExporter } from '../core'
import { type MeshObject, MM_NOTE, metalNotes, sceneObjects } from './meshes'

/** OBJ names may not contain whitespace in every reader. */
const objName = (name: string) => name.replace(/\s+/g, '_')

/**
 * A float32 coordinate written so it reads back as the same float32 (9 significant digits, then
 * trimmed). Rounding to a fixed 0.1 µm grid collapsed the sliver triangles a fused casting
 * keeps, which a reader then sees as degenerate faces and non-manifold edges.
 */
const num = (v: number) => {
  const f = Math.fround(v)
  if (f === 0) return '0'
  return Number.parseFloat(f.toPrecision(9)).toString()
}

export function writeObj(objects: readonly MeshObject[]): Uint8Array {
  const lines: string[] = ['# Pave OBJ export', '# units: millimetres']
  let base = 1
  for (const o of objects) {
    const name = objName(o.name)
    lines.push(`o ${name}`, `g ${name}`)
    if (o.kind === 'metal') lines.push(`# material ${o.material} ${o.finish} plating ${o.plating}`)
    else lines.push(`# stone ${o.stone.stone} ${o.stone.cut} ${o.stone.carat.toFixed(3)} ct`)
    const p = o.positions
    for (let i = 0; i < p.length; i += 3)
      lines.push(`v ${num(p[i]!)} ${num(p[i + 1]!)} ${num(p[i + 2]!)}`)
    for (let t = 0; t < o.indices.length; t += 3)
      lines.push(
        `f ${o.indices[t]! + base} ${o.indices[t + 1]! + base} ${o.indices[t + 2]! + base}`,
      )
    base += p.length / 3
  }
  return new TextEncoder().encode(`${lines.join('\n')}\n`)
}

export const obj = defineExporter({
  format: 'obj',
  detail: 'production',
  run(scene, options) {
    const objects = sceneObjects(scene, {
      stones: options.stones ?? true,
      ...(options.only && { only: options.only }),
    })
    return {
      bytes: writeObj(objects),
      mime: 'model/obj',
      extension: 'obj',
      notes: [
        MM_NOTE,
        'One object/group per metal part and per stone; materials are named in comments (no .mtl).',
        ...metalNotes(scene, objects),
      ],
    }
  },
})
