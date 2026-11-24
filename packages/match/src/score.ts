/**
 * How well a render explains a photo: silhouette overlap, stone overlap, and the mean distance
 * between outlines both ways. The loss is a fixed weighted sum (plan §12) so two builds of the
 * package agree on every number.
 */
import { components, distanceTransform, edges, moments, resize } from './mask'
import { mmPerPixel } from './scale'
import { matchStones } from './stones'
import type { Camera, LabelRaster, Prepared, Size, TargetView, ViewScore } from './types'

export const LOSS_WEIGHTS = {
  /** With a stone mask: the stones carry the interior structure a silhouette lacks. */
  stones: { iou: 0.35, stoneIou: 0.25, edge: 0.25, stoneEdge: 0.15 },
  plain: { iou: 0.6, edge: 0.4 },
  /** E = min(1, edgeScale · edgePx / width). */
  edgeScale: 20,
} as const

const SMALL = 96

function any(m: Uint8Array) {
  for (let i = 0; i < m.length; i++) if (m[i]) return true
  return false
}

export function prepareTarget(v: TargetView): Prepared {
  return prepare(v, true)
}

function prepare(v: TargetView, withSmall: boolean): Prepared {
  const size = { width: v.width, height: v.height }
  if (v.matte.length !== v.width * v.height)
    throw new Error(`prepareTarget: matte of "${v.id}" is not ${v.width}×${v.height}`)
  const edge = edges(v.matte, size)
  const hasStones = !!v.stones && any(v.stones)
  const stoneEdge = hasStones ? edges(v.stones!, size) : new Uint8Array(0)
  let small: Prepared | null = null
  const side = Math.max(v.width, v.height)
  if (withSmall && side > SMALL) {
    const k = SMALL / side
    const to = {
      width: Math.max(1, Math.round(v.width * k)),
      height: Math.max(1, Math.round(v.height * k)),
    }
    small = prepare(
      {
        ...v,
        ...to,
        matte: resize(v.matte, size, to),
        ...(v.stones ? { stones: resize(v.stones, size, to) } : {}),
        ...(v.parts
          ? { parts: v.parts.map((p) => ({ ...p, mask: resize(p.mask, size, to) })) }
          : {}),
        ...(v.marks ? { marks: v.marks.map((m) => ({ x: m.x * k, y: m.y * k, d: m.d * k })) } : {}),
      },
      false,
    )
  }
  return {
    view: v,
    moments: moments(v.matte, size),
    edge,
    edgeDist: distanceTransform(edge, size),
    stoneEdge,
    stoneEdgeDist: hasStones ? distanceTransform(stoneEdge, size) : new Float32Array(0),
    hasStones,
    small,
  }
}

/** Edge maps of a target's named parts, computed on first use. */
const partCache = new WeakMap<Uint8Array, { edge: Uint8Array; dist: Float32Array }>()
function partEdges(mask: Uint8Array, size: Size) {
  let p = partCache.get(mask)
  if (!p) {
    const edge = edges(mask, size)
    p = { edge, dist: distanceTransform(edge, size) }
    partCache.set(mask, p)
  }
  return p
}

/**
 * Mean distance between two outlines, both ways: each direction is the mean over one outline's
 * pixels of the distance to the other, each sample capped at a quarter of the width; the result
 * is the mean of the two directions. A missing outline scores the cap.
 */
function chamfer(
  ea: Uint8Array,
  distA: Float32Array,
  eb: Uint8Array,
  distB: Float32Array,
  cap: number,
) {
  let sa = 0
  let na = 0
  let sb = 0
  let nb = 0
  for (let k = 0; k < ea.length; k++) {
    if (ea[k]) {
      sa += Math.min(distB[k]!, cap)
      na++
    }
    if (eb[k]) {
      sb += Math.min(distA[k]!, cap)
      nb++
    }
  }
  if (!na || !nb) return na === nb ? 0 : cap
  return (sa / na + sb / nb) / 2
}

function iouOf(a: Uint8Array, b: Uint8Array) {
  let i = 0
  let u = 0
  for (let k = 0; k < a.length; k++) {
    const x = a[k]
    const y = b[k]
    if (x && y) i++
    if (x || y) u++
  }
  return u ? i / u : 1
}

export function scoreView(r: LabelRaster, t: Prepared, c: Camera): ViewScore {
  const v = t.view
  if (r.width !== v.width || r.height !== v.height)
    throw new Error(
      `scoreView: render ${r.width}×${r.height} against target ${v.width}×${v.height}`,
    )
  const size = { width: v.width, height: v.height }
  const n = v.width * v.height
  const cap = v.width / 4
  const metal = new Uint8Array(n)
  for (let k = 0; k < n; k++) metal[k] = r.cls[k] ? 1 : 0
  const iou = iouOf(metal, v.matte)
  const re = edges(metal, size)
  const edgePx = chamfer(re, distanceTransform(re, size), t.edge, t.edgeDist, cap)

  let stoneIou: number | null = null
  let stoneEdgePx: number | null = null
  let stone: Uint8Array | null = null
  if (t.hasStones) {
    stone = new Uint8Array(n)
    for (let k = 0; k < n; k++) stone[k] = r.cls[k] === 2 ? 1 : 0
    stoneIou = iouOf(stone, v.stones!)
    const se = edges(stone, size)
    stoneEdgePx = chamfer(se, distanceTransform(se, size), t.stoneEdge, t.stoneEdgeDist, cap)
  }

  const parts = (v.parts ?? []).map((p) => {
    const want = new Set(p.nodeIds.map((id) => r.nodeIds.indexOf(id) + 1).filter((i) => i > 0))
    const m = new Uint8Array(n)
    for (let k = 0; k < n; k++) m[k] = want.has(r.node[k]!) ? 1 : 0
    const pe = partEdges(p.mask, size)
    const me = edges(m, size)
    return {
      key: p.key,
      iou: iouOf(m, p.mask),
      edgePx: chamfer(me, distanceTransform(me, size), pe.edge, pe.dist, cap),
    }
  })

  let marks: ViewScore['marks'] = null
  if (v.marks) {
    if (!stone) {
      stone = new Uint8Array(n)
      for (let k = 0; k < n; k++) stone[k] = r.cls[k] === 2 ? 1 : 0
    }
    const mine = components(stone, size).map((s) => ({ x: s.cx, y: s.cy, d: s.d }))
    const ds = v.marks.map((m) => m.d).sort((a, b) => a - b)
    const maxPx = Math.max(3, 0.5 * (ds[ds.length >> 1] ?? 0))
    const m = matchStones(v.marks, mine, maxPx)
    marks = {
      matched: m.pairs.length,
      missing: m.missing.length,
      extra: m.extra.length,
      meanPx: m.meanPx,
    }
  }

  const E = (px: number) => Math.min(1, (LOSS_WEIGHTS.edgeScale * px) / v.width)
  let loss: number
  if (t.hasStones) {
    const W = LOSS_WEIGHTS.stones
    loss =
      W.iou * (1 - iou) +
      W.stoneIou * (1 - stoneIou!) +
      W.edge * E(edgePx) +
      W.stoneEdge * E(stoneEdgePx!)
  } else {
    const W = LOSS_WEIGHTS.plain
    loss = W.iou * (1 - iou) + W.edge * E(edgePx)
  }
  return {
    loss,
    iou,
    stoneIou,
    edgePx,
    edgeMm: edgePx * mmPerPixel(c, size),
    stoneEdgePx,
    parts,
    marks,
  }
}

/** Mean loss; the caller passes the fitted views only. */
export function combineLoss(scores: ViewScore[]): number {
  if (!scores.length) return 0
  return scores.reduce((s, x) => s + x.loss, 0) / scores.length
}
