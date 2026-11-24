/**
 * The fit (plan §7): a bounded, derivative-free coordinate search over the declared free numbers,
 * in which every trial build gets its own short camera re-polish, so shape and camera move
 * together (the prototype that alternated them stalled at 0.75 to 0.87 overlap).
 *
 * Deterministic: no randomness, a fixed order of trials, and the evaluation budget counted, not
 * timed. The time budget is a safety cap only; a fit that hits it can differ between machines.
 */
import type { Diagnostic, Evaluation } from '@pave/kernel/types'
import { applyOps, type Design } from '@pave/schema'
import { resize } from './mask'
import { opsFor, settle } from './params'
import { FIT_CAMERA_STEPS, refineCamera, searchPose, sizeOf } from './pose'
import { rasterize } from './raster'
import { prepareTarget, scoreView } from './score'
import type {
  Camera,
  FitInput,
  FitParam,
  FitResult,
  Prepared,
  Stats,
  TargetView,
  ViewScore,
} from './types'

/** The shape search runs at this larger side; the final camera stage at the photo's own, up to `FINE_PX`. */
export const WORK_PX = 192
export const FINE_PX = 384
/** Accept a trial only if the mean loss drops by more than this. */
const MIN_GAIN = 1e-5
/** The search stops when every step is below max(param.step, MIN_STEP). */
const MIN_STEP = 0.02
const FIRST_STEP = 0.12

/** A copy of a view with its larger side at most `side` pixels (nearest sampling). */
export function viewAt(v: TargetView, side: number): TargetView {
  const big = Math.max(v.width, v.height)
  if (big <= side) return v
  const k = side / big
  const from = { width: v.width, height: v.height }
  const to = {
    width: Math.max(1, Math.round(v.width * k)),
    height: Math.max(1, Math.round(v.height * k)),
  }
  return {
    ...v,
    ...to,
    matte: resize(v.matte, from, to),
    ...(v.stones ? { stones: resize(v.stones, from, to) } : {}),
    ...(v.parts ? { parts: v.parts.map((p) => ({ ...p, mask: resize(p.mask, from, to) })) } : {}),
    ...(v.marks ? { marks: v.marks.map((m) => ({ x: m.x * k, y: m.y * k, d: m.d * k })) } : {}),
  }
}

const hasError = (e: Evaluation) => e.diagnostics.some((d) => d.level === 'error')

class Stop extends Error {
  constructor(readonly reason: 'budget' | 'aborted') {
    super(reason)
  }
}

interface State {
  values: number[]
  design: Design
  ev: Evaluation
  cams: Camera[]
  scores: ViewScore[]
  loss: number
}

export async function fitDesign(i: FitInput): Promise<FitResult> {
  const started = performance.now()
  const maxEvals = i.budget?.evaluations ?? 250
  const maxMs = i.budget?.ms ?? 60_000
  const hide = i.hide ?? []
  const stats: Stats = { rasters: 0 }
  const notes: Diagnostic[] = []
  let evaluations = 0

  const fitted = i.views.filter((v) => !v.heldOut)
  if (!fitted.length) throw new Error('fitDesign: at least one view must be fitted (not held out)')
  const work: Prepared[] = fitted.map((v) => prepareTarget(viewAt(v, WORK_PX)))
  const fine: Prepared[] = fitted.map((v, j) =>
    Math.max(v.width, v.height) <= WORK_PX ? work[j]! : prepareTarget(viewAt(v, FINE_PX)),
  )
  const params = i.params

  const build = async (values: number[]) => {
    if (i.signal?.aborted) throw new Stop('aborted')
    if (evaluations >= maxEvals || performance.now() - started >= maxMs) throw new Stop('budget')
    const design = applyOps(i.design, opsFor(params, values)).design
    evaluations++
    try {
      return { design, ev: await i.evaluate(design, i.signal) }
    } catch (err) {
      if (i.signal?.aborted) throw new Stop('aborted')
      // A trial the kernel cannot build is a rejected trial, not a failed fit.
      if (!notes.some((n) => n.code === 'match.trialFailed'))
        notes.push({
          level: 'warning',
          code: 'match.trialFailed',
          message: `A trial build failed: ${String(err)}`,
        })
      return null
    }
  }

  const polish = (ev: Evaluation, cams: Camera[]) => {
    const r = work.map((t, j) =>
      refineCamera(ev, cams[j]!, t, { steps: FIT_CAMERA_STEPS, hide, stats }),
    )
    return {
      cams: r.map((x) => x.camera),
      scores: r.map((x) => x.score),
      loss: mean(r.map((x) => x.score.loss)),
    }
  }

  const startValues = params.map((p) => settle(p, p.start))
  let cur: State | null = null
  let stopped: FitResult['stopped'] = 'converged'

  try {
    const first = await build(startValues)
    if (!first || hasError(first.ev)) {
      const diagnostics = first ? first.ev.diagnostics : []
      return invalidStart(i, params, startValues, evaluations, stats, [...diagnostics, ...notes])
    }
    const cams = fitted.map(
      (v, j) => i.cameras?.[v.id] ?? searchPose(first.ev, work[j]!, { hide, stats }).camera,
    )
    cur = { values: startValues, design: first.design, ev: first.ev, ...polish(first.ev, cams) }

    const free = params
      .map((_, j) => j)
      .filter((j) => !params[j]!.pinned && params[j]!.max > params[j]!.min)
    const step = params.map((p) => FIRST_STEP * (p.max - p.min))
    const floor = params.map((p) => Math.max(p.step, MIN_STEP))

    const attempt = async (values: number[]): Promise<boolean> => {
      const b = await build(values)
      if (!b || hasError(b.ev)) return false
      const r = polish(b.ev, cur!.cams)
      if (r.loss < cur!.loss - MIN_GAIN) {
        cur = { values, design: b.design, ev: b.ev, ...r }
        i.onProgress?.(result(params, cur, fitted, evaluations, stats, 'budget', notes))
        return true
      }
      return false
    }

    while (free.some((j) => step[j]! >= floor[j]!)) {
      const before = cur.values.slice()
      let movedAny = false
      for (const j of free) {
        if (step[j]! < floor[j]!) continue
        for (const sgn of [1, -1]) {
          const y = cur.values.slice()
          y[j] = settle(params[j]!, y[j]! + sgn * step[j]!)
          if (y[j] === cur.values[j]) continue
          if (await attempt(y)) {
            movedAny = true
            break
          }
        }
      }
      if (movedAny) {
        // Pattern move: extrapolate the sweep's displacement once.
        const y = cur.values.map((v, j) => settle(params[j]!, v + (v - before[j]!)))
        if (y.some((v, j) => v !== cur!.values[j])) await attempt(y)
      } else for (const j of free) step[j] = step[j]! / 2
    }
  } catch (err) {
    if (!(err instanceof Stop)) throw err
    stopped = err.reason
    if (!cur) return invalidStart(i, params, startValues, evaluations, stats, notes, err.reason)
  }

  // Final camera stage at the photo's own resolution (up to 384 px): steps halving to 0.06°.
  // Specified from a true-shape test; untested end to end (plan §7).
  const state = cur!
  const finals = fine.map((t, j) =>
    refineCamera(state.ev, state.cams[j]!, t, {
      steps: FIT_CAMERA_STEPS,
      minAngle: 0.06,
      hide,
      stats,
    }),
  )
  const finalState: State = {
    ...state,
    cams: finals.map((f) => f.camera),
    scores: finals.map((f) => f.score),
    loss: mean(finals.map((f) => f.score.loss)),
  }
  const out = result(params, finalState, fitted, evaluations, stats, stopped, notes)

  // Held-out views: scored, never fitted. Their camera is searched on the final build alone.
  for (const v of i.views.filter((x) => x.heldOut)) {
    const t = prepareTarget(viewAt(v, FINE_PX))
    const known = i.cameras?.[v.id]
    const r = known
      ? {
          camera: known,
          score: scoreView(rasterize(state.ev, known, sizeOf(t), { hide, stats }), t, known),
        }
      : searchPose(state.ev, t, { hide, stats })
    out.cameras[v.id] = r.camera
    out.scores[v.id] = r.score
  }
  out.rasters = stats.rasters
  return out
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

function statusOf(p: FitParam, v: number): FitResult['params'][number]['status'] {
  if (p.pinned) return 'pinned'
  if (p.max > p.min && (Math.abs(v - p.min) < 1e-9 || Math.abs(v - p.max) < 1e-9)) return 'clamped'
  return 'fitted'
}

function result(
  params: FitParam[],
  s: State,
  fitted: TargetView[],
  evaluations: number,
  stats: Stats,
  stopped: FitResult['stopped'],
  notes: Diagnostic[],
): FitResult {
  const cameras: Record<string, Camera> = {}
  const scores: Record<string, ViewScore> = {}
  fitted.forEach((v, j) => {
    cameras[v.id] = s.cams[j]!
    scores[v.id] = s.scores[j]!
  })
  return {
    design: s.design,
    ops: opsFor(params, s.values),
    cameras,
    scores,
    loss: s.loss,
    params: params.map((p, j) => ({
      key: p.key,
      value: s.values[j]!,
      status: statusOf(p, s.values[j]!),
      sensitivity: 0,
    })),
    evaluations,
    rasters: stats.rasters,
    stopped,
    diagnostics: [...s.ev.diagnostics, ...notes],
  }
}

/** The start design cannot be built or carries a kernel error: nothing is fitted, never "converged". */
function invalidStart(
  i: FitInput,
  params: FitParam[],
  values: number[],
  evaluations: number,
  stats: Stats,
  diagnostics: Diagnostic[],
  reason: 'budget' | 'aborted' = 'aborted',
): FitResult {
  return {
    design: applyOps(i.design, opsFor(params, values)).design,
    ops: opsFor(params, values),
    cameras: {},
    scores: {},
    loss: Infinity,
    params: params.map((p, j) => ({
      key: p.key,
      value: values[j]!,
      status: p.pinned ? 'pinned' : 'assumed',
      sensitivity: 0,
    })),
    evaluations,
    rasters: stats.rasters,
    stopped: reason,
    diagnostics: [
      ...diagnostics,
      {
        level: 'error',
        code: 'match.invalidStart',
        message: 'The start design does not build cleanly, so nothing was fitted.',
      },
    ],
  }
}
