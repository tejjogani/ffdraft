/**
 * CAD files through the injected kernel, named per the research convention
 * (`cad/<sku>_<part>_<alloy>_<size>.stl`, `cad/<sku>_stones_REFERENCE.stl`, `cad/<sku>.3dm|.step`)
 * — one binary STL per castable metal part, metal only, no sprues. Each STL is read back and
 * checked for watertightness, because the bytes that ship are what the caster's software sees.
 */
import type { ExportFormat } from '@pave/kernel/types'
import type { PackageContext } from './context'
import type { StlCheck } from './dfm/checks'
import { analyzeTopology, instanceMesh, mergeTris } from './geometry/mesh'
import { readBinaryStl, writeBinaryStl } from './geometry/stl'
import { joinPath, safeSegment, uniqueName } from './paths'
import type { PackageFile } from './types'

export interface ExportNote {
  file: string
  notes: string[]
}

export interface CadExports {
  files: PackageFile[]
  notes: ExportNote[]
  stls: StlCheck[]
  /** Triangles per part id, as exported. */
  triangles: Record<string, number>
}

const MIME: Record<string, string> = {
  stl: 'model/stl',
  step: 'model/step',
  '3dm': 'model/vnd.3dm',
  '3mf': 'model/3mf',
}

export async function exportCad(ctx: PackageContext): Promise<CadExports> {
  const { kernel, design, evaluation, options } = ctx.input
  const files: PackageFile[] = []
  const notes: ExportNote[] = []
  const stls: StlCheck[] = []
  const triangles: Record<string, number> = {}
  const taken = new Set<string>()
  const supports = (f: ExportFormat) => kernel.formats.includes(f)
  const size = ctx.facts.ring
    ? safeSegment(ctx.facts.ring.sizes.us.replace(/\s+/g, '').replace('½', '.5'))
    : ''

  for (const part of evaluation.parts) {
    const name = uniqueName(
      `${[ctx.stem, safeSegment(part.name, 'part', 32), safeSegment(part.material, 'metal', 24), size].filter(Boolean).join('_')}.stl`,
      taken,
    )
    const path = joinPath('cad', name)
    const fileNotes: string[] = []
    // Never ship a package without casting meshes: when the kernel cannot export, the
    // production evaluation mesh is the same geometry.
    const fromEvaluation = (why: string) => {
      fileNotes.push(`${why}; written from the production evaluation mesh.`)
      return writeBinaryStl(part.mesh, `Pave ${ctx.stem} ${part.name} mm`)
    }
    let bytes: Uint8Array
    if (!supports('stl')) bytes = fromEvaluation('This kernel build cannot write STL')
    else {
      try {
        const r = await kernel.export(design, 'stl', { only: [part.nodeId], stones: false })
        bytes = r.bytes
        fileNotes.push(...r.notes)
      } catch (err) {
        bytes = fromEvaluation(`Kernel STL export failed (${(err as Error).message})`)
      }
    }
    const soup = readBinaryStl(bytes)
    const topology = soup
      ? analyzeTopology(soup.positions, soup.indices)
      : analyzeTopology(part.mesh.positions, part.mesh.indices)
    if (!soup) fileNotes.push('Not a binary STL; topology checked on the evaluation mesh.')
    triangles[part.id] = topology.triangles
    stls.push({ path, partId: part.id, nodeId: part.nodeId, bytes: bytes.length, topology })
    files.push({ path, bytes, mime: MIME.stl! })
    if (fileNotes.length) notes.push({ file: path, notes: fileNotes })
  }

  if (evaluation.stones.length) {
    const tris = evaluation.stones.flatMap((s) => {
      const mesh = evaluation.gemMeshes[s.meshKey]
      return mesh ? [instanceMesh(mesh, s.matrix)] : []
    })
    const path = joinPath('cad', `${ctx.stem}_stones_REFERENCE.stl`)
    files.push({
      path,
      bytes: writeBinaryStl(mergeTris(tris), `Pave ${ctx.stem} stones REFERENCE ONLY mm`),
      mime: MIME.stl!,
    })
    notes.push({
      file: path,
      notes: ['Stones only, for reference and setting. Never print or cast this file.'],
    })
  }

  const assemblies: ExportFormat[] = [
    '3dm',
    'step',
    ...(options.include3mf === false ? [] : (['3mf'] as const)),
  ]
  for (const format of assemblies) {
    const path = joinPath('cad', `${ctx.stem}.${format}`)
    if (!supports(format)) {
      notes.push({
        file: path,
        notes: [`Not produced: this kernel build cannot write ${format.toUpperCase()}.`],
      })
      continue
    }
    try {
      // 3DM/STEP are the editable assembly (stones on their own layer); 3MF goes to printers.
      const r = await kernel.export(design, format, { stones: format !== '3mf' })
      files.push({ path, bytes: r.bytes, mime: r.mime || MIME[format]! })
      if (r.notes.length) notes.push({ file: path, notes: r.notes })
    } catch (err) {
      notes.push({ file: path, notes: [`Not produced: ${(err as Error).message}`] })
    }
  }
  return { files, notes, stls, triangles }
}
