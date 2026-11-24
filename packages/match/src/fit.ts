/**
 * The fit (plan §7): a bounded, derivative-free coordinate search over the declared free numbers,
 * in which every trial build gets its own short camera re-polish, so shape and camera move
 * together (the prototype that alternated them stalled at 0.75 to 0.87 overlap).
 *
 * Deterministic: no randomness, a fixed order of trials, and the evaluation budget counted, not
 * timed. The time budget is a safety cap only; a fit that hits it can differ between machines.
 *
 * Failing safely: targets no fit can explain are refused before any build (`match.badTarget`),
 * and a fit that ends under the floor is reported `poor` (`match.poorFit`), never `converged`.
 */
import type { Diagnostic, Evaluation } from '@pave/kernel/types'
import { applyOps, type Design, type Op } from '@pave/schema'
import { type Guard, makeGuard, Stop } from './guard'
import { resize } from './mask'
import { opsFor, settle } from './params'
import { FIT_CAMERA_STEPS, refineCamera, searchPose, sizeOf } from './pose'
import { rasterize } from './raster'
import { checkTarget, prepareTarget, scoreView, underFloor } from './score'
import type {
  Camera,
  CameraSteps,
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
/**
 * Restarts (basin hopping): the coordinate search was measured to stop in local minima on numbers
 * that trade against each other and against the camera (band thickness, head height, elevation;
 * one clean three-quarter case stalled at loss 0.026 with the head height at 1.95 mm against a
 * truth of 2.4, where the truth scores 0). Each free number in turn is set to whichever of these
 * fractions of its band is farther from its value, the camera gets a deeper polish, and a short
 * descent runs from there (the probe that freed that case landed at four times the current loss,
 * so probes are not gated on their own loss); a hop is kept only if it ends lower than where it
 * started. A second round runs only when the first one won.
 */
const PROBES = [0.15, 0.85]
const PROBE_ROUNDS = 2
/** Most evaluations one hop's descent may use. */
const HOP_EVALUATIONS = 16

const PROBE_STEPS: CameraSteps = { angle: 4, logSpan: 0.04, shift: 0.02 }

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

/**
 * The design without the nodes a fit does not draw (pavé, chain), so the kernel does not build
 * them on every trial. A node another one depends on is kept (it is still left out of rendering).
 */
export function withoutHidden(d: Design, hide: readonly string[]): Design {
  let out = d
  for (const id of hide) {
    if (!out.nodes[id]) continue
    try {
      out = applyOps(out, [{ t: 'remove', id }]).design
    } catch {
      // Used by a visible node: kept.
    }
  }
  return out
}

/** Ops restricted to nodes that exist in `d` (a lean design lacks the hidden ones). */
export const opsOn = (d: Design, ops: Op[]) =>
  ops.filter((o) => o.t !== 'update' || !!d.nodes[o.id])

const hasError = (e: Evaluation) => e.diagnostics.some((d) => d.level === 'error')

interface State {
  values: number[]
  ev: Evaluation
  cams: Camera[]
  scores: ViewScore[]
  loss: number
}

export async function fitDesign(i: FitInput): Promise<FitResult> {
  const started = performance.now()
  const maxEvals = i.budget?.evaluations ?? 250
  // The search leaves `reserve` evaluations for the observability check.
  const searchEvals = Math.max(1, maxEvals - (i.budget?.reserve ?? 0))
  const maxMs = i.budget?.ms ?? 60_000
  const hide = i.hide ?? []
  const stats: Stats = { rasters: 0 }
  const notes: Diagnostic[] = []
  const guard: Guard = makeGuard(i.signal, started + maxMs)
  let evaluations = 0
  const params = i.params
  const startValues = params.map((p) => settle(p, p.start))

  const fitted = i.views.filter((v) => !v.heldOut)
  if (!fitted.length) throw new Error('fitDesign: at least one view must be fitted (not held out)')
  // Refuse what no fit can explain, before any kernel call.
  const bad = fitted.map(checkTarget).filter((d): d is Diagnostic => d !== null)
  if (bad.length) return notFitted(i, params, startValues, 0, stats, bad, 'rejected')

  const work: Prepared[] = fitted.map((v) => prepareTarget(viewAt(v, WORK_PX)))
  const fine: Prepared[] = fitted.map((v, j) =>
    Math.max(v.width, v.height) <= WORK_PX ? work[j]! : prepareTarget(viewAt(v, FINE_PX)),
  )
  const lean = withoutHidden(i.design, hide)

  const build = async (values: number[]) => {
    guard.check()
    if (evaluations >= searchEvals) throw new Stop('budget')
    const design = applyOps(lean, opsOn(lean, opsFor(params, values))).design
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

  // Trial polishes keep the seeded diagonal tries: dropping them (two thirds of a rejected trial's
  // renders) was measured to leave the head-height valley unsolved and a weak number clamped.
  const polish = async (
    ev: Evaluation,
    cams: Camera[],
    steps = FIT_CAMERA_STEPS,
    minAngle?: number,
    diagonal = true,
  ) => {
    const r: { camera: Camera; score: ViewScore }[] = []
    for (const [j, t] of work.entries())
      r.push(
        await refineCamera(ev, cams[j]!, t, {
          steps,
          hide,
          stats,
          guard,
          diagonal,
          ...(minAngle !== undefined ? { minAngle } : {}),
        }),
      )
    return {
      cams: r.map((x) => x.camera),
      scores: r.map((x) => x.score),
      loss: mean(r.map((x) => x.score.loss)),
    }
  }

  let cur: State | null = null
  let stopped: FitResult['stopped'] = 'converged'
  let stopReason: Stop['reason'] | null = null

  try {
    const first = await build(startValues)
    if (!first || hasError(first.ev)) {
      const diagnostics = first ? first.ev.diagnostics : []
      return notFitted(i, params, startValues, evaluations, stats, [
        ...diagnostics,
        ...notes,
        {
          level: 'error',
          code: 'match.invalidStart',
          message: 'The start design does not build cleanly, so nothing was fitted.',
        },
      ])
    }
    const cams: Camera[] = []
    for (const [j, v] of fitted.entries()) {
      const known = i.cameras?.[v.id]
      if (known) {
        cams.push(known)
        continue
      }
      const p = await searchPose(first.ev, work[j]!, { hide, stats, guard })
      if (!p.found)
        notes.push({
          level: 'warning',
          code: 'match.poseNotFound',
          message: `No camera of the start design explains view "${v.id}" (overlap ${p.score.iou.toFixed(3)}).`,
        })
      cams.push(p.camera)
    }
    cur = { values: startValues, ev: first.ev, ...(await polish(first.ev, cams)) }

    const free = params
      .map((_, j) => j)
      .filter((j) => !params[j]!.pinned && params[j]!.max > params[j]!.min)
    const floor = params.map((p) => Math.max(p.step, MIN_STEP))

    const accept = (values: number[], ev: Evaluation, r: Omit<State, 'values' | 'ev'>) => {
      cur = { values, ev, ...r }
      i.onProgress?.(result(i, params, cur, fitted, evaluations, stats, 'budget', notes))
    }
    const attempt = async (values: number[]): Promise<boolean> => {
      const b = await build(values)
      if (!b || hasError(b.ev)) return false
      const r = await polish(b.ev, cur!.cams)
      if (r.loss < cur!.loss - MIN_GAIN) {
        accept(values, b.ev, r)
        return true
      }
      return false
    }
    const descend = async (first: number, cap = Infinity) => {
      const step = params.map((p) => first * (p.max - p.min))
      while (free.some((j) => step[j]! >= floor[j]!) && evaluations < cap) {
        const before = cur!.values.slice()
        let movedAny = false
        for (const j of free) {
          if (step[j]! < floor[j]!) continue
          for (const sgn of [1, -1]) {
            const y = cur!.values.slice()
            y[j] = settle(params[j]!, y[j]! + sgn * step[j]!)
            if (y[j] === cur!.values[j]) continue
            if (await attempt(y)) {
              movedAny = true
              break
            }
          }
        }
        if (movedAny) {
          // Pattern move: extrapolate the sweep's displacement once.
          const y = cur!.values.map((v, j) => settle(params[j]!, v + (v - before[j]!)))
          if (y.some((v, j) => v !== cur!.values[j])) await attempt(y)
        } else for (const j of free) step[j] = step[j]! / 2
      }
    }

    await descend(FIRST_STEP)
    for (let round = 0; round < PROBE_ROUNDS; round++) {
      let won = false
      for (const j of free) {
        const p = params[j]!
        const at = (q: number) => settle(p, p.min + q * (p.max - p.min))
        const far = PROBES.map(at).sort(
          (a, b) => Math.abs(b - cur!.values[j]!) - Math.abs(a - cur!.values[j]!),
        )[0]!
        if (Math.abs(far - cur!.values[j]!) < 0.2 * (p.max - p.min)) continue
        const y = cur!.values.slice()
        y[j] = far
        const b = await build(y)
        if (!b || hasError(b.ev)) continue
        const home: State = cur!
        try {
          const r = await polish(b.ev, home.cams, PROBE_STEPS, 0.6)
          cur = { values: y, ev: b.ev, ...r }
          await descend(FIRST_STEP / 2, evaluations + HOP_EVALUATIONS)
        } finally {
          // A hop that has not beaten home is undone, also when the budget stops it midway.
          const hop: State = cur!
          if (hop.loss < home.loss - MIN_GAIN) {
            if (hop !== home) {
              accept(hop.values, hop.ev, hop)
              won = true
            }
          } else cur = home
        }
      }
      if (!won) break
    }
  } catch (err) {
    if (!(err instanceof Stop)) throw err
    stopReason = err.reason
    stopped = err.reason === 'aborted' ? 'aborted' : 'budget'
    if (!cur) {
      const why =
        err.reason === 'aborted'
          ? 'The fit was cancelled before the first camera was found.'
          : 'The budget ran out before the first camera was found.'
      return notFitted(
        i,
        params,
        startValues,
        evaluations,
        stats,
        [...notes, { level: 'error', code: 'match.stoppedEarly', message: why }],
        stopped,
      )
    }
  }

  const state: State = cur!
  let finalState = state
  // Final camera stage at the photo's own resolution (up to 384 px): steps halving to 0.06°.
  // Skipped when cancelled or out of time; then the scores are at the working resolution.
  if (stopReason !== 'aborted' && stopReason !== 'time') {
    try {
      const finals: { camera: Camera; score: ViewScore }[] = []
      for (const [j, t] of fine.entries())
        finals.push(
          await refineCamera(state.ev, state.cams[j]!, t, {
            steps: FIT_CAMERA_STEPS,
            minAngle: 0.06,
            hide,
            stats,
            guard,
          }),
        )
      finalState = {
        ...state,
        cams: finals.map((f) => f.camera),
        scores: finals.map((f) => f.score),
        loss: mean(finals.map((f) => f.score.loss)),
      }
    } catch (err) {
      if (!(err instanceof Stop)) throw err
      stopReason = err.reason
      stopped = err.reason === 'aborted' ? 'aborted' : 'budget'
      notes.push({
        level: 'info',
        code: 'match.finalSkipped',
        message: 'The final camera stage was cut short; scores are at the working resolution.',
      })
    }
  }
  const out = result(i, params, finalState, fitted, evaluations, stats, stopped, notes)

  // Held-out views: scored, never fitted. Their camera is searched on the final build alone.
  for (const v of i.views.filter((x) => x.heldOut)) {
    if (stopReason === 'aborted' || stopReason === 'time') break
    const badHeld = checkTarget(v)
    if (badHeld) {
      out.diagnostics.push({ ...badHeld, level: 'warning' })
      continue
    }
    const t = prepareTarget(viewAt(v, FINE_PX))
    const known = i.cameras?.[v.id]
    try {
      const r = known
        ? {
            camera: known,
            score: scoreView(rasterize(state.ev, known, sizeOf(t), { hide, stats }), t, known),
          }
        : await searchPose(state.ev, t, { hide, stats, guard })
      out.cameras[v.id] = r.camera
      out.scores[v.id] = r.score
    } catch (err) {
      if (!(err instanceof Stop)) throw err
      if (err.reason === 'aborted') out.stopped = 'aborted'
      break
    }
  }
  out.rasters = stats.rasters
  return out
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

function statusOf(p: FitParam, v: number): FitResult['params'][number]['status'] {
  if (p.pinned) return 'pinned'
  if (p.max > p.min && (Math.abs(v - p.min) < 1e-9 || Math.abs(v - p.max) < 1e-9)) return 'clamped'
  if (p.max > p.min && v === settle(p, p.start)) return 'unmoved'
  return 'fitted'
}

function result(
  i: FitInput,
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
  const ops = opsFor(params, s.values)
  // Under the floor: the recipe does not explain the photo, whatever stopped the search.
  const poor = fitted
    .map((v, j) => ({ id: v.id, why: underFloor(s.scores[j]!, i.floor) }))
    .filter((x) => x.why)
  const diagnostics = [...s.ev.diagnostics, ...notes]
  if (poor.length)
    diagnostics.push({
      level: 'warning',
      code: 'match.poorFit',
      message: `The best fit is under the floor: ${poor.map((x) => `"${x.id}" ${x.why}`).join('; ')}.`,
    })
  return {
    design: applyOps(i.design, ops).design,
    ops,
    cameras,
    scores,
    loss: s.loss,
    params: params.map((p, j) => ({
      key: p.key,
      value: s.values[j]!,
      status: statusOf(p, s.values[j]!),
      sensitivity: 0,
      uncertainty: null,
    })),
    evaluations,
    rasters: stats.rasters,
    stopped: poor.length && stopped === 'converged' ? 'poor' : stopped,
    quality: poor.length ? 'poor' : 'good',
    diagnostics,
  }
}

/** Nothing was fitted: a refused target, an invalid start, or a stop before the first camera. */
function notFitted(
  i: FitInput,
  params: FitParam[],
  values: number[],
  evaluations: number,
  stats: Stats,
  diagnostics: Diagnostic[],
  stopped: FitResult['stopped'] = 'aborted',
): FitResult {
  const ops = opsFor(params, values)
  return {
    design: applyOps(i.design, ops).design,
    ops,
    cameras: {},
    scores: {},
    loss: Infinity,
    params: params.map((p, j) => ({
      key: p.key,
      value: values[j]!,
      status: p.pinned ? 'pinned' : 'assumed',
      sensitivity: 0,
      uncertainty: null,
    })),
    evaluations,
    rasters: stats.rasters,
    stopped,
    quality: 'failed',
    diagnostics,
  }
}
