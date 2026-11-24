/**
 * Mesh import: the format is sniffed from the bytes (file names and MIME types lie), then parsed
 * into an unwelded triangle soup in the file's units with Z up.
 */
import type { IndexedTriangles } from '../../solid/meshing'
import { isGlb, parseGlb } from './glb'
import { looksLikeObj, parseObj } from './obj'
import { looksLikePly, parsePly } from './ply'
import { isBinaryStl, looksLikeAsciiStl, parseStl } from './stl'
import { headText } from './text'
import { isZip, parse3mf } from './threemf'

export type MeshFormat = 'stl' | 'obj' | 'ply' | 'glb' | '3mf'

export function sniffMeshFormat(bytes: Uint8Array): MeshFormat | null {
  if (isGlb(bytes)) return 'glb'
  if (isZip(bytes)) return '3mf'
  if (isBinaryStl(bytes)) return 'stl'
  const head = headText(bytes, 4096)
  if (looksLikePly(head)) return 'ply'
  if (looksLikeAsciiStl(head)) return 'stl'
  if (looksLikeObj(head)) return 'obj'
  return null
}

const PARSERS: Record<MeshFormat, (bytes: Uint8Array) => IndexedTriangles> = {
  stl: parseStl,
  obj: parseObj,
  ply: parsePly,
  glb: parseGlb,
  '3mf': parse3mf,
}

export function parseMesh(bytes: Uint8Array): { mesh: IndexedTriangles; format: MeshFormat } {
  const format = sniffMeshFormat(bytes)
  if (!format) {
    const head = headText(bytes, 64).trimStart()
    throw new Error(
      head.startsWith('{')
        ? 'This looks like a .gltf file with separate resources; export it as a single binary .glb instead.'
        : 'The file is not a mesh format Pavé can read. Use STL, OBJ, PLY, GLB or 3MF.',
    )
  }
  const mesh = PARSERS[format](bytes)
  if (mesh.indices.length === 0)
    throw new Error(`The ${format.toUpperCase()} file contains no triangles`)
  for (const v of mesh.positions)
    if (!Number.isFinite(v))
      throw new Error(`The ${format.toUpperCase()} file has invalid vertex coordinates`)
  return { mesh, format }
}
