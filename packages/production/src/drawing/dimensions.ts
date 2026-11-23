/**
 * Which dimensions and callouts each view carries (research "Drawings" row: ring size, band
 * width and thickness, pendant H×W, stone sizes; Decisions: stone callouts keyed to stones.csv
 * and the stamp location). Values come from design parameters where the designer set them and
 * from evaluated geometry otherwise; positions always come from geometry so leaders land on
 * the drawn lines.
 */
import type { Evaluation, StoneInstance, StoneLot } from '@pave/kernel/types'
import { GEM_CUTS, GEM_MATERIALS, METALS } from '@pave/schema'
import type { PieceFacts } from '../facts'
import { DIAMETER, type Units, fmtCarat, fmtLength } from '../format'
import { transformPoint } from '../geometry/vec'
import type { Box2, ViewLines } from './hlr'
import { VIEWS, type ViewId, project } from './views'

export type P2 = [number, number]
export type Side = 'below' | 'above' | 'left' | 'right'

export type Annotation =
  | {
      kind: 'linear'
      view: ViewId
      a: P2
      b: P2
      axis: 'h' | 'v'
      side: Side
      text: string
      caption?: string
    }
  | {
      kind: 'note'
      view: ViewId
      anchor: P2
      lines: string[]
      side: 'left' | 'right'
      head: 'arrow' | 'dot'
      /** Leader leaves the anchor radially away from this point (holes, girdles). */
      radialFrom?: P2
      /** Circled key (stone lot) drawn ahead of the text. */
      badge?: string
    }
  | { kind: 'centerline'; view: ViewId; a: P2; b: P2 }
  | { kind: 'cutline'; view: ViewId; x: number; label: string }

/** A stone lot's key in drawings and stones.csv: S1, S2, … in report order. */
export const lotKey = (i: number) => `S${i + 1}`

export function stonesOfLot(lot: StoneLot, stones: readonly StoneInstance[]): StoneInstance[] {
  return stones.filter(
    (s) => lot.nodeIds.includes(s.nodeId) && s.cut === lot.cut && Math.abs(s.dims.width - lot.width) < 0.011,
  )
}

export interface AnnotationInput {
  facts: PieceFacts
  evaluation: Evaluation
  views: Partial<Record<ViewId, ViewLines>>
  units: Units
  stampLocation: string
}

export function extractAnnotations(input: AnnotationInput): Annotation[] {
  const { facts, units } = input
  const out: Annotation[] = []
  const L = (mm: number) => fmtLength(mm, units)
  const ex = (id: ViewId) => (input.views[id] ? extremes(input.views[id]!) : undefined)

  // Overall envelope: width and height on the front, depth on the side.
  const front = ex('front')
  const side = ex('side')
  const isPendant = !facts.ring && !!facts.bail
  if (front) {
    out.push({ kind: 'linear', view: 'front', a: front.left, b: front.right, axis: 'h', side: 'below', text: L(front.right[0] - front.left[0]) })
    out.push({
      kind: 'linear',
      view: 'front',
      a: front.bottom,
      b: front.top,
      axis: 'v',
      side: 'right',
      text: L(front.top[1] - front.bottom[1]),
      ...(isPendant ? { caption: 'overall incl. bail' } : {}),
    })
  }
  if (side) {
    out.push({ kind: 'linear', view: 'side', a: side.left, b: side.right, axis: 'h', side: 'below', text: L(side.right[0] - side.left[0]) })
  }

  if (facts.ring) ringAnnotations(input, out, L)
  if (isPendant) pendantAnnotations(input, out, L)
  stoneAnnotations(input, out, L)
  markAnnotations(input, out)
  return out
}

function ringAnnotations(input: AnnotationInput, out: Annotation[], L: (mm: number) => string) {
  const ring = input.facts.ring!
  const n = ring.node
  const r = ring.innerDiameter / 2
  const top = input.facts.bounds.max[2]
  const reach = r + Math.max(n.thicknessTop, n.thicknessBottom) + 1.5

  out.push({ kind: 'centerline', view: 'front', a: [-reach, 0], b: [reach, 0] })
  out.push({ kind: 'cutline', view: 'front', x: 0, label: 'A' })
  const a = (215 * Math.PI) / 180
  out.push({
    kind: 'note',
    view: 'front',
    anchor: [r * Math.cos(a), r * Math.sin(a)],
    radialFrom: [0, 0],
    head: 'arrow',
    side: 'left',
    lines: [`${DIAMETER}${L(ring.innerDiameter)} inside`, `${ring.sizes.us} · ${ring.sizes.uk} · ${ring.sizes.eu}`],
  })
  if (input.facts.centre || input.facts.settings.length > 0) {
    out.push({ kind: 'linear', view: 'front', a: [0, r], b: [0, top], axis: 'v', side: 'right', text: L(top - r), caption: 'head above finger' })
  }

  const side = input.views.side
  if (side) {
    const z0 = input.facts.bounds.min[2] - 1
    out.push({ kind: 'centerline', view: 'side', a: [0, z0], b: [0, top + 1] })
    out.push({ kind: 'centerline', view: 'side', a: [-n.widthBottom / 2 - 1.5, 0], b: [n.widthBottom / 2 + 1.5, 0] })
  }

  if (input.views.section) {
    const wb = n.widthBottom / 2
    const wt = n.widthTop / 2
    const same = Math.abs(n.widthTop - n.widthBottom) < 0.01
    out.push({
      kind: 'linear',
      view: 'section',
      a: [-wb, -r - n.thicknessBottom],
      b: [wb, -r - n.thicknessBottom],
      axis: 'h',
      side: 'below',
      text: L(n.widthBottom),
      caption: same ? 'band width' : 'width at base',
    })
    out.push({ kind: 'linear', view: 'section', a: [wb, -r - n.thicknessBottom], b: [wb, -r], axis: 'v', side: 'right', text: L(n.thicknessBottom), caption: 'base' })
    out.push({ kind: 'linear', view: 'section', a: [wt, r], b: [wt, r + n.thicknessTop], axis: 'v', side: 'right', text: L(n.thicknessTop), caption: 'top' })
    if (!same) {
      out.push({ kind: 'note', view: 'section', anchor: [-wt, r + n.thicknessTop / 2], head: 'arrow', side: 'left', lines: [`${L(n.widthTop)} width at top`] })
    }
  }
}

function pendantAnnotations(input: AnnotationInput, out: Annotation[], L: (mm: number) => string) {
  const { facts } = input
  const front = input.views.front
  const b = facts.bounds
  if (Math.abs(b.min[0] + b.max[0]) < 0.2 && front) {
    out.push({ kind: 'centerline', view: 'front', a: [0, b.min[2] - 1.5], b: [0, b.max[2] + 1.5] })
  }
  if (facts.body && front) {
    const body = facts.body.bounds
    const e = extremes(front, (_x, y) => y <= body.max[2] + 1e-3)
    out.push({ kind: 'linear', view: 'front', a: e.bottom, b: e.top, axis: 'v', side: 'right', text: L(e.top[1] - e.bottom[1]), caption: 'body' })
  }
  if (input.views.section && facts.body) {
    const body = facts.body.bounds
    const zMid = (body.min[2] + body.max[2]) / 2
    out.push({ kind: 'cutline', view: 'front', x: 0, label: 'A' })
    out.push({
      kind: 'linear',
      view: 'section',
      a: [body.min[1], zMid],
      b: [body.max[1], zMid],
      axis: 'h',
      side: 'below',
      text: L(body.max[1] - body.min[1]),
      caption: 'metal thickness',
    })
  }
  const bail = facts.bail!
  if (input.views.side) {
    const bb = bail.part?.bounds ?? b
    const cy = (bb.min[1] + bb.max[1]) / 2
    out.push({
      kind: 'note',
      view: 'side',
      anchor: [cy, bb.max[2] - bail.node.wire],
      head: 'arrow',
      side: 'right',
      lines: [`Bail opening ${L(bail.node.opening)}`, `${bail.node.style}, ${L(bail.node.wire)} wire`],
    })
  }
}

/** One keyed callout per stone lot, pointing at a representative, viewer-facing stone. */
function stoneAnnotations(input: AnnotationInput, out: Annotation[], L: (mm: number) => string) {
  const { evaluation, facts } = input
  const viewId: ViewId = facts.ring ? 'top' : 'front'
  if (!input.views[viewId]) return
  const view = VIEWS[viewId]

  evaluation.report.lots.forEach((lot, i) => {
    const members = stonesOfLot(lot, evaluation.stones)
    if (members.length === 0) return
    const facing = members.filter((s) => {
      const up = transformPoint(s.matrix, 0, 0, 1)
      const c = transformPoint(s.matrix, 0, 0, 0)
      return (up[0] - c[0]) * view.toward[0] + (up[1] - c[1]) * view.toward[1] + (up[2] - c[2]) * view.toward[2] > 0
    })
    const pool = facing.length ? facing : members
    const centroid = pool.reduce<[number, number, number]>(
      (acc, s) => [acc[0] + s.matrix[12]! / pool.length, acc[1] + s.matrix[13]! / pool.length, acc[2] + s.matrix[14]! / pool.length],
      [0, 0, 0],
    )
    const rep = pool.reduce((best, s) =>
      dist2(s.matrix, centroid) < dist2(best.matrix, centroid) ? s : best,
    )
    const c = project(view, [rep.matrix[12]!, rep.matrix[13]!, rep.matrix[14]!])
    const isCentre = lot.role === 'center' && facts.centre?.instance?.id === rep.id
    const size =
      lot.cut === 'round' ? `${DIAMETER}${L(lot.width)}` : `${L(lot.length)} × ${L(lot.width)}`
    const head = lot.count > 1 ? `${lot.count} × ${size}` : size
    const ct = lot.count > 1 ? `${fmtCarat(lot.caratTotal)} total` : fmtCarat(lot.caratEach)
    // Callouts gather on the side without vertical dimensions: right of a ring's plan view,
    // left of a pendant's front view. Big stones get the leader on their girdle, melee on the
    // stone centre.
    const radius = lot.width / 2
    const right = !!facts.ring
    const angle = right ? Math.PI / 4 : (3 * Math.PI) / 4
    const anchor: P2 = isCentre || lot.width >= 3 ? [c[0] + radius * Math.cos(angle), c[1] + radius * Math.sin(angle)] : [c[0], c[1]]
    out.push({
      kind: 'note',
      view: viewId,
      anchor,
      ...(isCentre || lot.width >= 3 ? { radialFrom: [c[0], c[1]] as P2 } : {}),
      head: lot.width >= 3 ? 'arrow' : 'dot',
      side: right ? 'right' : 'left',
      badge: lotKey(i),
      lines: [head, `${GEM_MATERIALS[lot.stone].label}, ${GEM_CUTS[lot.cut].label.toLowerCase()}`, `${ct} · ${lot.setting}`],
    })
    if (isCentre && lot.cut !== 'round') centreStoneDims(input, rep, out, L)
  })
}

function centreStoneDims(input: AnnotationInput, stone: StoneInstance, out: Annotation[], L: (mm: number) => string) {
  const mesh = input.evaluation.gemMeshes[stone.meshKey]
  if (!mesh) return
  const view = VIEWS.top
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const w = transformPoint(stone.matrix, mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!)
    const [x, y] = project(view, w)
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  out.push({ kind: 'linear', view: 'top', a: [minX, cy], b: [maxX, cy], axis: 'h', side: 'above', text: L(maxX - minX) })
  out.push({ kind: 'linear', view: 'top', a: [cx, minY], b: [cx, maxY], axis: 'v', side: 'left', text: L(maxY - minY) })
}

/** Engraving text and the fineness stamp: where they go and what they say. */
function markAnnotations(input: AnnotationInput, out: Annotation[]) {
  const { facts } = input
  const metal = input.evaluation.parts[0]?.material
  const stamp = metal ? METALS[metal].hallmark : ''
  if (facts.ring) {
    const r = facts.ring.innerDiameter / 2
    const at = (deg: number): P2 => [r * Math.sin((deg * Math.PI) / 180), r * Math.cos((deg * Math.PI) / 180)]
    for (const e of facts.engravings) {
      out.push({
        kind: 'note',
        view: 'front',
        anchor: at(e.angle),
        head: 'arrow',
        side: 'left',
        lines: [`${e.mode === 'engrave' ? 'Engrave' : 'Emboss'} “${e.text}”`, `${e.where}, ${e.size.toFixed(2)} ${e.font}, ${e.depth.toFixed(2)} ${e.mode === 'engrave' ? 'deep' : 'high'}`],
      })
    }
    if (stamp) {
      out.push({ kind: 'note', view: 'front', anchor: at(160), head: 'arrow', side: 'right', lines: [`Stamp ${stamp} + maker’s mark`, input.stampLocation] })
    }
  } else if (stamp && input.views.side) {
    const b = (facts.body ?? { bounds: facts.bounds }).bounds
    out.push({
      kind: 'note',
      view: 'side',
      anchor: [b.max[1], b.min[2] + (b.max[2] - b.min[2]) * 0.3],
      head: 'arrow',
      side: 'right',
      lines: [`Stamp ${stamp} + maker’s mark`, input.stampLocation],
    })
  }
}

const dist2 = (m: readonly number[], c: [number, number, number]) =>
  (m[12]! - c[0]) ** 2 + (m[13]! - c[1]) ** 2 + (m[14]! - c[2]) ** 2

export interface Extremes {
  left: P2
  right: P2
  bottom: P2
  top: P2
  box: Box2
}

/** Extreme drawn points of a view (optionally restricted), so extension lines start on lines. */
export function extremes(lines: ViewLines, keep: (x: number, y: number) => boolean = () => true): Extremes {
  let left: P2 = [Infinity, 0]
  let right: P2 = [-Infinity, 0]
  let bottom: P2 = [0, Infinity]
  let top: P2 = [0, -Infinity]
  for (const group of [lines.metal, lines.stones]) {
    for (const pl of group) {
      for (let i = 0; i < pl.length; i += 2) {
        const x = pl[i]!
        const y = pl[i + 1]!
        if (!keep(x, y)) continue
        if (x < left[0]) left = [x, y]
        if (x > right[0]) right = [x, y]
        if (y < bottom[1]) bottom = [x, y]
        if (y > top[1]) top = [x, y]
      }
    }
  }
  return { left, right, bottom, top, box: { minX: left[0], maxX: right[0], minY: bottom[1], maxY: top[1] } }
}
