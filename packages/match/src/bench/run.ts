/**
 * One benchmark case end to end: every discrete option is built and fitted (`chooseDiscrete`),
 * the winner goes through `observability`, and the result is compared with the hidden truth.
 * Failures are counted beside accuracy (invalid builds, throws, abstentions), never folded in.
 */
import { applyOps } from '@pave/schema'
import { cameraBasis } from '../camera'
import { chooseDiscrete } from '../choose'
import { fitDesign, viewAt, WORK_PX } from '../fit'
import { observability } from '../observe'
import { searchPose } from '../pose'
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
  /** Angle between the true and fitted viewing directions of the first view, symmetric twins equal. */
  cameraErrDeg: number | null
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
    const input: FitInput = {
      design: c.start,
      params: c.params,
      views: c.views,
      evaluate: counted,
      hide,
      budget: { evaluations: o.evaluations ?? 250, ms: 10 * 60_000 },
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
      starts[v.id] = [searchPose(startEv, prepareTarget(viewAt(v, WORK_PX)), { hide }).score.iou]
    if (o.observe !== false) result = await observability(result, input)

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
