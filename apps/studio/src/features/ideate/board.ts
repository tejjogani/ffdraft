/**
 * The design board, the arithmetic and the rules: what a dropped or pasted thing becomes, where
 * a tile sits on the canvas until someone moves it, and which tiles can go to CAD. Pure, so the
 * board, its drop zone and the tests share one definition.
 */
import type { CanvasPlacement, Reference } from '@pave/schema'

/** What a file becomes on the board, by extension (MIME types are unreliable across systems). */
export type BoardFile = 'image' | 'model' | 'step' | null

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'avif'])
/** The 3D formats the board shows and CAD opens (the kernel's importers). */
export const MODEL_EXTENSIONS = ['stl', 'obj', 'glb', '3mf', 'ply'] as const
const MODEL = new Set<string>(MODEL_EXTENSIONS)

export const extensionOf = (name: string): string => name.toLowerCase().split('.').pop() ?? ''

export function classifyBoardFile(name: string): BoardFile {
  const ext = extensionOf(name)
  if (IMAGE.has(ext)) return 'image'
  if (MODEL.has(ext)) return 'model'
  if (ext === 'step' || ext === 'stp') return 'step'
  return null
}

export const BOARD_IMAGE_ACCEPT = [...IMAGE].map((e) => `.${e}`).join(',')
export const BOARD_ACCEPT = [...IMAGE, ...MODEL, 'step', 'stp'].map((e) => `.${e}`).join(',')

/** Web addresses in pasted or dropped text (a Pinterest pin, a Google result, a shop page). */
export function urlsIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"']+/g) ?? []
  return [...new Set(found.map((u) => u.replace(/[),.;]+$/, '')))].slice(0, 20)
}

/** The canvas's grid: where a tile sits until it is dragged somewhere (board units are px). */
export const CANVAS_TILE = 220
const GAP = 24
export const CANVAS_COLUMNS = 5

export function gridPlacement(index: number, columns = CANVAS_COLUMNS): CanvasPlacement {
  return {
    x: (index % columns) * (CANVAS_TILE + GAP),
    // A row is as tall as a portrait picture with its caption, so tiles never overlap.
    y: Math.floor(index / columns) * (Math.round(CANVAS_TILE * 1.6) + GAP),
    w: CANVAS_TILE,
    z: index,
  }
}

/** Every tile's place on the canvas: its saved one, else the next free grid cell. */
export function canvasLayout(refs: readonly Reference[]): Map<string, CanvasPlacement> {
  const out = new Map<string, CanvasPlacement>()
  let next = 0
  for (const r of refs) out.set(r.id, r.canvas ?? gridPlacement(next++))
  return out
}

/** A placement moved by a drag, on top of everything else. */
export const movedTo = (
  p: CanvasPlacement,
  dx: number,
  dy: number,
  topZ: number,
): CanvasPlacement => ({ ...p, x: Math.round(p.x + dx), y: Math.round(p.y + dy), z: topZ + 1 })

/** What can be taken to CAD: a picture or sketch the CAD job may read (never a view-only one). */
export function takeToCadRefusal(ref: Reference): string | null {
  if (ref.type === 'model') return 'Open a 3D model as CAD instead'
  if (!ref.assetId || (ref.type !== 'image' && ref.type !== 'generated'))
    return ref.type === 'link'
      ? 'A link has no picture to build from: capture its image first'
      : 'Only a picture or a sketch can go to CAD'
  if (ref.rights === 'viewOnly')
    return 'View only: it can’t be sent to AI. Pin it beside CAD and model over it by hand.'
  return null
}

/** The goal of the CAD job a picture starts (one owner: the job recipes). */
export { TAKE_TO_CAD_GOAL } from '@pave/agent/studio'
