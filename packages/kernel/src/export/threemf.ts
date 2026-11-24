/**
 * 3MF (3D Manufacturing Format): a zip holding one XML model — one object per part with its
 * name and alloy as a base material with display colour, units millimetre. Stones, when asked
 * for, are `other` objects coloured by material: resources only, never build items, because
 * the core spec does not let a build item reference an object of type `other`.
 */

import { GEM_MATERIALS, METALS } from '@pave/schema'
import { zipSync } from 'fflate'
import { defineExporter } from '../core'
import { type MeshObject, MM_NOTE, metalNotes, objectColor, sceneObjects } from './meshes'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const materialKey = (o: MeshObject) => (o.kind === 'metal' ? o.material : o.stone.stone)
const materialLabel = (o: MeshObject) =>
  o.kind === 'metal' ? METALS[o.material].label : GEM_MATERIALS[o.stone.stone].label

export function writeThreeMf(objects: readonly MeshObject[]): Uint8Array {
  const materials = [...new Map(objects.map((o) => [materialKey(o), o])).values()]
  const pindex = new Map(materials.map((o, i) => [materialKey(o), i]))
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    '<metadata name="Application">Pave</metadata>',
    '<resources>',
    `<basematerials id="1">${materials.map((o) => `<base name="${xmlEscape(materialLabel(o))}" displaycolor="${objectColor(o)}FF"/>`).join('')}</basematerials>`,
  ]
  objects.forEach((o, i) => {
    out.push(
      `<object id="${i + 2}" type="${o.kind === 'metal' ? 'model' : 'other'}" name="${xmlEscape(o.name)}" pid="1" pindex="${pindex.get(materialKey(o))}"><mesh><vertices>`,
    )
    const p = o.positions
    const v: string[] = []
    for (let k = 0; k < p.length; k += 3)
      v.push(`<vertex x="${p[k]}" y="${p[k + 1]}" z="${p[k + 2]}"/>`)
    out.push(v.join(''), '</vertices><triangles>')
    const t: string[] = []
    for (let k = 0; k < o.indices.length; k += 3)
      t.push(`<triangle v1="${o.indices[k]}" v2="${o.indices[k + 1]}" v3="${o.indices[k + 2]}"/>`)
    out.push(t.join(''), '</triangles></mesh></object>')
  })
  out.push(
    '</resources>',
    `<build>${objects.flatMap((o, i) => (o.kind === 'metal' ? [`<item objectid="${i + 2}"/>`] : [])).join('')}</build>`,
    '</model>',
  )
  const encode = (s: string) => new TextEncoder().encode(s)
  return zipSync(
    {
      '[Content_Types].xml': encode(CONTENT_TYPES),
      '_rels/.rels': encode(RELS),
      '3D/3dmodel.model': encode(out.join('\n')),
    },
    // A fixed timestamp keeps identical designs byte-identical. Zip stores local time, so the
    // date is given in local components (the zip epoch) and reads the same in every time zone.
    { mtime: new Date(1980, 0, 1) },
  )
}

export const threeMf = defineExporter({
  format: '3mf',
  detail: 'production',
  run(scene, options) {
    const stones = options.stones ?? false
    const objects = sceneObjects(scene, { stones, ...(options.only && { only: options.only }) })
    const notes = [
      MM_NOTE,
      'One object per metal part, named and coloured by alloy.',
      ...metalNotes(scene, objects),
    ]
    if (stones)
      notes.push(
        'Stones are included as reference objects that are not placed on the build plate; some viewers do not show them.',
      )
    return { bytes: writeThreeMf(objects), mime: 'model/3mf', extension: '3mf', notes }
  },
})
