/**
 * How well a render explains a photo: silhouette overlap, stone overlap, and the mean distance
 * between outlines both ways. The loss is a fixed weighted sum (plan §12) so two builds of the
 * package agree on every number.
 *
 * A stone mask that is supplied but empty means "the photo shows no stones": the stone terms stay
 * in the loss, so a model that draws a stone there is penalised. Leave `stones` undefined when the
 * segmenter did not look for stones; only then are the stone terms dropped.
 */
import type { Diagnostic } from '@pave/kernel/types'
import { components, distanceTransform, edges, moments, resize } from './mask'
import { mmPerPixel } from './scale'
import { matchStones } from './stones'
import type { Camera, LabelRaster, Prepared, Size, TargetView, ViewScore } from './types'

export const LOSS_WEIGHTS = {
  /** With a stone mask: the stones carry the interior structure a silhouette lacks. */
  stones: { iou: 0.35, stoneIou: 0.25, edge: 0.25, stoneEdge: 0.15 },
  plain: { iou: 0.6, edge: 0.4 },
  /** E = min(1, edgeScale · edgePx / larger side). */
  edgeScale: 20,
} as const

const SMALL = 96

/**
 * The floor of a usable fit, per fitted view. Under it the fit is reported `poor`, never
 * `converged`, and the loop sends the piece down the ladder (plan §2 step 9, §8 "failing safely").
 * Calibrated on the synthetic benchmark only: the true design against its own `noisy` masks scores
 * a loose overlap of 0.94 to 1.00 and a stone overlap of 0.58 to 0.90 (eight recipes, three seeds;
 * `hard` masks 0.85 to 0.98 and 0.28 to 0.86). Unverified on photos.
 */
export const FIT_FLOOR = { looseIou: 0.9, stoneIou: 0.25 } as const

/**
 * Why a view's score is under the floor, or null. The overlap tested is `looseIou`, which forgives
 * outline noise; stone overlap counts only where stones were looked for.
 */
export function underFloor(
  s: ViewScore,
  floor: { looseIou?: number; stoneIou?: number } = {},
): string | null {
  const iou = floor.looseIou ?? FIT_FLOOR.looseIou
  const stoneIou = floor.stoneIou ?? FIT_FLOOR.stoneIou
  const why: string[] = []
  if (!(s.looseIou >= iou))
    why.push(`overlap ${s.looseIou.toFixed(3)} < ${iou} (outline noise forgiven)`)
  if (s.stoneIou !== null && !(s.stoneIou >= stoneIou))
    why.push(`stone overlap ${s.stoneIou.toFixed(3)} < ${stoneIou}`)
  return why.length ? why.join(', ') : null
}

/**
 * Targets no fit can explain, refused before any kernel call: a subject under `minArea` or over
 * `maxArea` of the frame, or one touching all four borders (the camera would zoom in until the
 * model fills the frame and score a perfect overlap). Starting values, not measured on photos.
 */
export const TARGET_LIMITS = { minArea: 0.01, maxArea: 0.9 } as const

/** Why a view cannot be fitted, or null when it can. */
export function checkTarget(v: TargetView): Diagnostic | null {
  const { width: w, height: h } = v
  let area = 0
  let left = false
  let right = false
  let top = false
  let bottom = false
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (v.matte[y * w + x]) {
        area++
        if (x === 0) left = true
        if (x === w - 1) right = true
        if (y === 0) top = true
        if (y === h - 1) bottom = true
      }
  const frac = area / Math.max(1, w * h)
  const why =
    frac < TARGET_LIMITS.minArea
      ? `the subject covers ${(frac * 100).toFixed(2)} % of the frame (under ${TARGET_LIMITS.minArea * 100} %)`
      : frac > TARGET_LIMITS.maxArea
        ? `the subject covers ${(frac * 100).toFixed(1)} % of the frame (over ${TARGET_LIMITS.maxArea * 100} %)`
        : left && right && top && bottom
          ? 'the subject touches all four borders, so its outline is not in the photo'
          : null
  return why
    ? {
        level: 'error',
        code: 'match.badTarget',
        message: `View "${v.id}" cannot be fitted: ${why}.`,
      }
    : null
}

export function prepareTarget(v: TargetView): Prepared {
  return prepare(v, true)
}

function prepare(v: TargetView, withSmall: boolean): Prepared {
  const size = { width: v.width, height: v.height }
  if (v.matte.length !== v.width * v.height)
    throw new Error(`prepareTarget: matte of "${v.id}" is not ${v.width}×${v.height}`)
  const edge = edges(v.matte, size)
  if (v.stones && v.stones.length !== v.width * v.height)
    throw new Error(`prepareTarget: stone mask of "${v.id}" is not ${v.width}×${v.height}`)
  // Supplied, even if empty: "no stones seen" is evidence, unlike "not looked for".
  const hasStones = v.stones !== undefined
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

/**
 * Outline tolerance of `looseIou`: a segmenter's outline on polished metal is off by a pixel or
 * two, which costs a thin piece (a name pendant's letters) a third of its plain overlap even when
 * the design is exactly right. Starting value, measured on the synthetic `noisy` level only.
 */
export const looseRadius = (side: number) => Math.max(2, 0.01 * side)

/**
 * Overlap that forgives outline error up to `r` px, both ways: a pixel drawn outside the target
 * counts only if it is farther than `r` from the target, and a target pixel left undrawn only if
 * it is farther than `r` from the render (`renderDist`: distance to the render's outline).
 */
function looseIouOf(render: Uint8Array, renderDist: Float32Array, t: Prepared, r: number) {
  const target = t.view.matte
  let miss = 0
  let u = 0
  for (let k = 0; k < render.length; k++) {
    const x = render[k]
    const y = target[k]
    if (x || y) u++
    if (x && !y && t.edgeDist[k]! > r) miss++
    else if (y && !x && renderDist[k]! > r) miss++
  }
  return u ? 1 - miss / u : 1
}

/** Overlap; two empty masks agree (1). */
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

/**
 * Scratch buffers for one image size, reused by every score of that size: nothing here escapes a
 * call, and a call never yields, so one set per size is safe on one thread.
 */
interface Scratch {
  mask: Uint8Array
  edge: Uint8Array
  dist: Float32Array
}
const scratch = new Map<number, Scratch>()
function scratchFor(n: number): Scratch {
  let s = scratch.get(n)
  if (!s) {
    if (scratch.size > 8) scratch.clear()
    s = { mask: new Uint8Array(n), edge: new Uint8Array(n), dist: new Float32Array(n) }
    scratch.set(n, s)
  }
  return s
}

export function scoreView(r: LabelRaster, t: Prepared, c: Camera): ViewScore {
  const v = t.view
  if (r.width !== v.width || r.height !== v.height)
    throw new Error(
      `scoreView: render ${r.width}×${r.height} against target ${v.width}×${v.height}`,
    )
  const size = { width: v.width, height: v.height }
  const n = v.width * v.height
  // The larger side sets the scale, as it does for the camera's span.
  const side = Math.max(v.width, v.height)
  const cap = side / 4
  const S = scratchFor(n)
  const metal = S.mask
  let drawn = 0
  for (let k = 0; k < n; k++) {
    const x = r.cls[k] ? 1 : 0
    metal[k] = x
    drawn += x
  }
  // A render that draws nothing explains nothing, even an empty target.
  const iou = drawn ? iouOf(metal, v.matte) : 0
  const re = edges(metal, size, S.edge)
  const reDist = distanceTransform(re, size, S.dist)
  const edgePx = chamfer(re, reDist, t.edge, t.edgeDist, cap)
  const looseIou = drawn ? looseIouOf(metal, reDist, t, looseRadius(side)) : 0

  let stoneIou: number | null = null
  let stoneEdgePx: number | null = null
  if (t.hasStones) {
    const stone = metal
    for (let k = 0; k < n; k++) stone[k] = r.cls[k] === 2 ? 1 : 0
    stoneIou = iouOf(stone, v.stones!)
    const se = edges(stone, size, S.edge)
    stoneEdgePx = chamfer(
      se,
      distanceTransform(se, size, S.dist),
      t.stoneEdge,
      t.stoneEdgeDist,
      cap,
    )
  }

  const parts = (v.parts ?? []).map((p) => {
    const want = new Set(p.nodeIds.map((id) => r.nodeIds.indexOf(id) + 1).filter((i) => i > 0))
    const m = S.mask
    for (let k = 0; k < n; k++) m[k] = want.has(r.node[k]!) ? 1 : 0
    const pe = partEdges(p.mask, size)
    const pIou = iouOf(m, p.mask)
    const me = edges(m, size, S.edge)
    return {
      key: p.key,
      iou: pIou,
      edgePx: chamfer(me, distanceTransform(me, size, S.dist), pe.edge, pe.dist, cap),
    }
  })

  let marks: ViewScore['marks'] = null
  if (v.marks) {
    const stone = S.mask
    for (let k = 0; k < n; k++) stone[k] = r.cls[k] === 2 ? 1 : 0
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

  const E = (px: number) => Math.min(1, (LOSS_WEIGHTS.edgeScale * px) / side)
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
    looseIou,
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
