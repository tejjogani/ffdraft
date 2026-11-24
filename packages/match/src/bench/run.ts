/**
 * One benchmark case end to end: every discrete option is built and fitted (`chooseDiscrete`),
 * the winner goes through `observability`, and the result is compared with the hidden truth.
 * Failures are counted beside accuracy (invalid builds, throws, abstentions), never folded in.
 */
import type { Evaluation } from '@pave/kernel/types'
import { applyOps } from '@pave/schema'
import { cameraBasis, project } from '../camera'
import { chooseDiscrete } from '../choose'
import { fitDesign, viewAt, WORK_PX } from '../fit'
import { distanceTransform } from '../mask'
import { observability } from '../observe'
import { searchPose } from '../pose'
import { worldVertices } from '../raster'
import { prepareTarget } from '../score'
import type { Camera, Evaluate, FitInput, FitResult, ParamStatus } from '../types'
import { type BenchCase, visibleFacts } from './synth'

export interface CaseResult {
  id: string
  templateId: string
  viewSet: string
  level: string
  threw: string | null
  /** The final build carries a kernel error. */
  invalid: boolean
  discrete: { truth: string; picked: string; decided: boolean; margin: number } | null
  params: {
    key: string
    truth: number
    start: number
    value: number
    errMm: number
    errPct: number
    status: ParamStatus
    depthLike: boolean
  }[]
  /** Fitted views: overlap of the start design at its searched camera, and after the fit. */
  iouBefore: number[]
  iouAfter: number[]
  heldOutIou: number | null
  /** Angle between the true and fitted viewing directions of the first view (only the 180° twin known). */
  cameraErrDeg: number | null
  /**
   * Camera error of the first view as a reprojection: the true piece's points drawn by the true
   * and by the fitted camera, mean nearest distance both ways, in % of the larger image side.
   * Symmetric twins (any symmetry, a plain band's included) score 0, as they draw the same image.
   */
  reprojPct: number | null
  /** `good`, `poor` or `failed` (see `FitResult.quality`). */
  quality: FitResult['quality'] | null
  /** Per named part: the lowest overlap over the fitted views. */
  partIou: Record<string, number>
  weightErrPct: number
  caratErrPct: number | null
  evaluations: number
  rastersPerView: number
  ms: number
  stopped: FitResult['stopped'] | null
}

const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!

/** Rings look the same from (az, el) and (az + 180°, el); azimuth is ignored above 70°. */
export function cameraError(truth: Camera, fit: Camera, ring: boolean): number {
  if (truth.elevation > 70 && fit.elevation > 70) return Math.abs(truth.elevation - fit.elevation)
  const t = cameraBasis(truth.azimuth, truth.elevation).back
  const twins = ring ? [fit.azimuth, fit.azimuth + 180] : [fit.azimuth]
  return Math.min(
    ...twins.map((az) => {
      const f = cameraBasis(az, fit.elevation).back
      return (Math.acos(Math.max(-1, Math.min(1, dot(t, f)))) * 180) / Math.PI
    }),
  )
}

export async function runCase(
  c: BenchCase,
  evaluate: Evaluate,
  o: { evaluations?: number; screen?: number; observe?: boolean } = {},
): Promise<CaseResult & { result: FitResult | null }> {
  const t0 = performance.now()
  const hide = c.recipe.hide ?? []
  let evaluations = 0
  const counted: Evaluate = (d, s) => {
    evaluations++
    return evaluate(d, s)
  }
  const base: CaseResult = {
    id: c.id,
    templateId: c.recipe.templateId,
    viewSet: c.viewSet,
    level: c.level,
    threw: null,
    invalid: false,
    discrete: null,
    params: [],
    iouBefore: [],
    iouAfter: [],
    heldOutIou: null,
    cameraErrDeg: null,
    reprojPct: null,
    quality: null,
    partIou: {},
    weightErrPct: Number.NaN,
    caratErrPct: null,
    evaluations: 0,
    rastersPerView: 0,
    ms: 0,
    stopped: null,
  }
  const fittedIds = c.views.filter((v) => !v.heldOut).map((v) => v.id)
  const starts: Record<string, number[]> = {}
  try {
    const observe = o.observe !== false
    const free = c.params.filter((p) => !p.pinned && p.max > p.min).length
    const input: FitInput = {
      design: c.start,
      params: c.params,
      views: c.views,
      evaluate: counted,
      hide,
      // The visibility check runs under the same budget: two builds per number, plus one.
      budget: {
        evaluations: o.evaluations ?? 250,
        ms: 10 * 60_000,
        ...(observe ? { reserve: 2 * free + 2 } : {}),
      },
    }
    let result: FitResult
    let picked = '-'
    let decided = true
    let margin = Infinity
    if (c.candidates.length > 1) {
      const ch = await chooseDiscrete({ ...input, candidates: c.candidates, screen: o.screen })
      result = ch.ranked[0]!.result
      picked = ch.ranked[0]!.id
      decided = ch.decided
      margin = ch.margin
    } else result = await fitDesign(input)
    // "Before": the start design (first candidate) at its own searched camera; not counted.
    const startEv = await evaluate(applyOps(c.start, c.candidates[0]!.ops).design)
    for (const v of c.views.filter((x) => !x.heldOut))
      starts[v.id] = [
        (await searchPose(startEv, prepareTarget(viewAt(v, WORK_PX)), { hide })).score.iou,
      ]
    if (observe) result = await observability(result, input)

    const final = await evaluate(result.design)
    const invalid = final.diagnostics.some((d) => d.level === 'error')
    const facts = visibleFacts(final, hide)
    const values = new Map(result.params.map((p) => [p.key, p]))
    const params = c.params.map((p, j) => {
      const r = values.get(p.key)!
      const truth = c.truthValues[j]!
      return {
        key: p.key,
        truth,
        start: p.start,
        value: r.value,
        errMm: Math.abs(r.value - truth),
        errPct: (Math.abs(r.value - truth) / Math.max(Math.abs(truth), 1e-9)) * 100,
        status: r.status,
        depthLike: c.recipe.depthLike.includes(p.key),
      }
    })
    const first = fittedIds[0]!
    const heldId = c.views.find((v) => v.heldOut)?.id
    const partIou: Record<string, number> = {}
    for (const id of fittedIds)
      for (const p of result.scores[id]?.parts ?? [])
        partIou[p.key] = Math.min(partIou[p.key] ?? 1, p.iou)
    const truthEv = await evaluate(c.truth)
    return {
      ...base,
      invalid,
      discrete: c.truthOption !== null ? { truth: c.truthOption, picked, decided, margin } : null,
      params,
      iouBefore: fittedIds.map((id) => starts[id]![0]!),
      iouAfter: fittedIds.map((id) => result.scores[id]?.iou ?? 0),
      heldOutIou: heldId ? (result.scores[heldId]?.iou ?? null) : null,
      cameraErrDeg: result.cameras[first]
        ? cameraError(c.truthCameras[first]!, result.cameras[first]!, c.recipe.kind === 'ring')
        : null,
      reprojPct: result.cameras[first]
        ? reprojection(truthEv, c.truthCameras[first]!, result.cameras[first]!, hide)
        : null,
      quality: result.quality,
      partIou,
      weightErrPct: (Math.abs(facts.weightG - c.truthWeightG) / c.truthWeightG) * 100,
      caratErrPct:
        c.truthCarat > 0 ? (Math.abs(facts.carat - c.truthCarat) / c.truthCarat) * 100 : null,
      evaluations,
      rastersPerView: result.rasters / Math.max(1, c.views.length),
      ms: performance.now() - t0,
      stopped: result.stopped,
      result,
    }
  } catch (err) {
    return {
      ...base,
      threw: String(err instanceof Error ? (err.stack ?? err.message) : err),
      evaluations,
      ms: performance.now() - t0,
      result: null,
    }
  }
}

/**
 * Reprojection error between two cameras of the same piece: the piece's vertices (up to 4,000)
 * projected by each, the mean distance from each point set to the nearest point of the other,
 * both ways, in % of the larger image side. Distances use a chamfer map of the first set on a
 * grid twice the image, so points slightly out of frame still count.
 */
export function reprojection(e: Evaluation, a: Camera, b: Camera, hide: string[] = []): number {
  const n = 192
  const size = { width: n, height: n }
  const pos = worldVertices(e, hide)
  const count = pos.length / 3
  if (!count) return Number.NaN
  const stride = Math.max(1, Math.floor(count / 4000))
  const pa: [number, number][] = []
  const pb: [number, number][] = []
  for (let i = 0; i < count; i += stride) {
    const p: [number, number, number] = [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!]
    const x = project(a, size, p)
    const y = project(b, size, p)
    if (x.depth > 0) pa.push([x.x, x.y])
    if (y.depth > 0) pb.push([y.x, y.y])
  }
  const G = 2 * n
  const off = n / 2
  const grid = { width: G, height: G }
  const mapOf = (pts: [number, number][]) => {
    const m = new Uint8Array(G * G)
    for (const [x, y] of pts) {
      const gx = Math.min(G - 1, Math.max(0, Math.floor(x + off)))
      const gy = Math.min(G - 1, Math.max(0, Math.floor(y + off)))
      m[gy * G + gx] = 1
    }
    return distanceTransform(m, grid)
  }
  const meanTo = (pts: [number, number][], d: Float32Array) => {
    let s = 0
    for (const [x, y] of pts) {
      const gx = Math.min(G - 1, Math.max(0, Math.floor(x + off)))
      const gy = Math.min(G - 1, Math.max(0, Math.floor(y + off)))
      s += d[gy * G + gx]!
    }
    return pts.length ? s / pts.length : Number.NaN
  }
  const da = mapOf(pa)
  const db = mapOf(pb)
  return ((meanTo(pb, da) + meanTo(pa, db)) / 2 / n) * 100
}
