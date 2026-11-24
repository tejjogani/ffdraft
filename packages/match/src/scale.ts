/**
 * Scale is asked, never inferred (plan §5): one anchor fixes millimetres, everything else is
 * fitted relative to it. Without one, the design keeps its default size and says so.
 */
import { type Design, formatRingSize, gemDimsFromCarat, type Op } from '@pave/schema'
import type { Camera, ScaleAnchor, Size } from './types'

export function mmPerPixel(c: Camera, size: Size): number {
  return c.span / Math.max(size.width, size.height)
}

type AnyNode = Record<string, unknown> & { kind: string }

function nodeOf(d: Design, id: string): AnyNode {
  const n = d.nodes[id] as AnyNode | undefined
  if (!n) throw new Error(`applyAnchor: no node "${id}"`)
  return n
}

export function applyAnchor(
  d: Design,
  a: ScaleAnchor,
): {
  ops: Op[]
  pins: Record<string, number>
  spanMm?: { viewId: string; span: number }
  assumed: boolean
  label: string
} {
  switch (a.type) {
    case 'ringSize': {
      const n = nodeOf(d, a.nodeId)
      if (n.kind !== 'ringShank') throw new Error(`applyAnchor: "${a.nodeId}" is not a ring band`)
      return {
        ops: [{ t: 'update', id: a.nodeId, patch: { size: a.size } }],
        pins: {},
        assumed: false,
        label: `Ring size ${formatRingSize(a.size)}`,
      }
    }
    case 'stone': {
      const n = nodeOf(d, a.nodeId)
      if (n.kind !== 'gem') throw new Error(`applyAnchor: "${a.nodeId}" is not a stone`)
      let width = a.widthMm
      if (width === undefined) {
        if (a.carat === undefined) throw new Error('applyAnchor: a stone anchor needs carats or mm')
        width = gemDimsFromCarat(n.cut as never, a.carat, n.stone as never, n.lw as number).width
      }
      width = Math.round(width * 100) / 100
      return {
        ops: [{ t: 'update', id: a.nodeId, patch: { width } }],
        pins: { [`${a.nodeId}.width`]: width },
        assumed: false,
        label: a.carat !== undefined ? `Centre stone ${a.carat} ct` : `Centre stone ${width} mm`,
      }
    }
    case 'height': {
      const n = nodeOf(d, a.nodeId)
      if (typeof n.height !== 'number')
        throw new Error(`applyAnchor: "${a.nodeId}" (${n.kind}) has no height`)
      return {
        ops: [{ t: 'update', id: a.nodeId, patch: { height: a.mm } }],
        pins: { [`${a.nodeId}.height`]: a.mm },
        assumed: false,
        label: `${a.mm} mm tall`,
      }
    }
    case 'reference':
      // Approximate: the object is rarely at the piece's depth.
      return {
        ops: [],
        pins: {},
        spanMm: { viewId: a.viewId, span: (a.diameterMm / a.mark.d) * a.side },
        assumed: false,
        label: `Reference object, ${a.diameterMm} mm`,
      }
    case 'assumed':
      return { ops: [], pins: {}, assumed: true, label: 'Scale assumed: every size is relative' }
  }
}
