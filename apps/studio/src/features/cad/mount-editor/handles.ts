import type { XYZ } from '../mesh-edit/model'

export type CageOffsets = [XYZ, XYZ, XYZ, XYZ, XYZ, XYZ, XYZ, XYZ]
export type CageBounds = {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
}
export type CageHandle = { kind: 'corner' | 'face'; index: number } | { kind: 'all' }

export const cornerIds = [0, 1, 2, 3, 4, 5, 6, 7] as const
export const faceNames = [
  'Left (−X)',
  'Right (+X)',
  'Front (−Y)',
  'Back (+Y)',
  'Bottom (−Z)',
  'Top (+Z)',
]
const sides = [
  ['Left', 'Right'],
  ['Front', 'Back'],
  ['Bottom', 'Top'],
] as const

export function cornerName(index: number): string {
  return sides.map((pair, axis) => pair[(index >> axis) & 1]).join(' / ')
}

export function cornerPoint({ min, max }: CageBounds, index: number): XYZ {
  return [index & 1 ? max[0] : min[0], index & 2 ? max[1] : min[1], index & 4 ? max[2] : min[2]]
}

export function cornersFor(handle: CageHandle): readonly number[] {
  if (handle.kind === 'all') return cornerIds
  if (handle.kind === 'corner') return [handle.index]
  const axis = Math.floor(handle.index / 2)
  return cornerIds.filter((corner) => ((corner >> axis) & 1) === handle.index % 2)
}

export function zeroOffsets(): CageOffsets {
  return [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
}

export function moveHandles(offsets: CageOffsets, handle: CageHandle, delta: XYZ): CageOffsets {
  const next: CageOffsets = [...offsets]
  for (const corner of cornersFor(handle)) {
    const [x, y, z] = offsets[corner]!
    next[corner] = [x + delta[0], y + delta[1], z + delta[2]]
  }
  return next
}

export function handleOffsets(offsets: CageOffsets, handle: CageHandle) {
  const corners = cornersFor(handle)
  const first = offsets[corners[0]!]!
  return first.map((value, axis) =>
    corners.every((i) => Math.abs(offsets[i]![axis]! - value) < 1e-8) ? value : null,
  )
}
