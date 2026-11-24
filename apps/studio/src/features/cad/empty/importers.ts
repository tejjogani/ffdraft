/**
 * Bringing something in: files are classified by extension (MIME types are unreliable across
 * operating systems — Windows reports STL as `application/vnd.ms-pki.stl`, many systems report
 * nothing), then turned into the node that makes them castable.
 */
import { newId, type NodeInput } from '@pave/schema'

export type ImportKind = 'mesh' | 'svg' | 'image'

const BY_EXTENSION: Record<string, ImportKind> = {
  stl: 'mesh',
  obj: 'mesh',
  glb: 'mesh',
  '3mf': 'mesh',
  ply: 'mesh',
  svg: 'svg',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
}

export const IMPORT_ACCEPT = Object.keys(BY_EXTENSION)
  .map((e) => `.${e}`)
  .join(',')

export function classifyImport(fileName: string): ImportKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  return BY_EXTENSION[ext] ?? null
}

const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, '').slice(0, 80) || undefined

/** All path outlines of an SVG document, joined into one path. Shapes other than paths are not read. */
export function svgPathData(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return null
  const d = [...doc.querySelectorAll('path')]
    .map((p) => p.getAttribute('d')?.trim())
    .filter(Boolean)
    .join(' ')
  return d || null
}

export const meshNode = (assetId: string, fileName: string): NodeInput => ({
  id: newId('meshBody'),
  kind: 'meshBody',
  name: baseName(fileName),
  source: { type: 'asset', assetId },
})

export const builtinNode = (name: 'trophy' | 'crown' | 'dice'): NodeInput => ({
  id: newId('meshBody'),
  kind: 'meshBody',
  source: { type: 'builtin', name },
})

export const outlineNode = (d: string, fileName: string): NodeInput => ({
  id: newId('vectorBody'),
  kind: 'vectorBody',
  name: baseName(fileName),
  source: { type: 'svg', d },
})

export const textNode = (text: string): NodeInput => ({
  id: newId('vectorBody'),
  kind: 'vectorBody',
  name: text.slice(0, 80),
  source: { type: 'text', text, font: 'script' },
})

export const reliefNode = (assetId: string, fileName: string): NodeInput => ({
  id: newId('relief'),
  kind: 'relief',
  name: baseName(fileName),
  assetId,
})
