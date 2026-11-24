/**
 * What the photos could see (plan §7). Each fitted number is nudged both ways; the nudged build
 * gets its own camera re-polish (the camera can absorb a change: a thicker band seen from above
 * is matched by tilting the camera), and the loss rise that is left is the number's signal.
 *
 * - No pixel of any fitted view changes: **assumed**, back to its start.
 * - The signal is too small to stand out of the fit's residual (or a supplied mask-noise
 *   estimate): **weak**. Its `uncertainty` says how far it could move unseen. It keeps the
 *   fitted value, which still carries some evidence (a head height fitted to 1.95 mm against a
 *   truth of 2.4 beat its start of 1.2), unless that value sits on a bound of its band: a weak
 *   number on a bound is the search running off, not a reading, so it goes back to its start.
 * - Otherwise its status from the fit stands (`fitted`, `clamped` or `unmoved`).
 *
 * The same nudges, rendered from the canon views, say which second photo would help most.
 */
import type { Evaluation } from '@pave/kernel/types'
import { applyOps, type Design } from '@pave/schema'
import { defaultCamera, VIEW_SEEDS, type ViewSeed } from './camera'
import { FINE_PX, opsOn, viewAt, WORK_PX, withoutHidden } from './fit'
import { makeGuard, Stop } from './guard'
import { opsFor, settle } from './params'
import { FIT_CAMERA_STEPS, refineCamera } from './pose'
import { rasterize } from './raster'
import { prepareTarget, underFloor } from './score'
import type { Camera, Evaluate, FitInput, FitParam, FitResult, Prepared, Stats } from './types'

/** Changed pixels, as a fraction of the subject, below which a number counts as unseen. */
export const OBSERVE_THRESHOLD = 0.0015
export const NUDGE = 0.1
/**
 * A change whose loss rise is under `HIDE_FRACTION` of the residual is taken to be hidden by it.
 * With a quadratic loss, the change that could hide is nudge · √(HIDE_FRACTION · residual / rise).
 * Calibrated on the synthetic benchmark only; unverified on photos.
 */
export const HIDE_FRACTION = 0.5
/** A number whose hidden change exceeds min(this, a quarter of its band) is weak. Field units (mm). */
export const TOLERANCE = 0.5

function changedFraction(a: Uint8Array, b: Uint8Array): number {
  let changed = 0
  let subject = 0
  for (let k = 0; k < a.length; k++) {
    if (a[k] !== b[k]) changed++
    if (a[k]) subject++
  }
  return subject ? changed / subject : changed ? 1 : 0
}

export async function observability(r: FitResult, i: FitInput): Promise<FitResult> {
  if (r.quality === 'failed') return r
  const hide = i.hide ?? []
  const stats: Stats = { rasters: 0 }
  const guard = makeGuard(i.signal, performance.now() + (i.budget?.ms ?? 60_000))
  // The check runs under the same evaluation budget as the fit (see `budget.reserve`).
  const maxEvals = i.budget?.evaluations ?? 250
  let evaluations = 0
  const fitted = i.views.filter((v) => !v.heldOut && r.cameras[v.id])
  const work: Prepared[] = fitted.map((v) => prepareTarget(viewAt(v, WORK_PX)))
  const values = i.params.map((p) => r.params.find((x) => x.key === p.key)?.value ?? p.start)
  // Built on the fitted design, so ops a discrete choice added before the fit are kept.
  const lean = withoutHidden(r.design, hide)
  const evalOf = (vals: number[]) => {
    guard.check()
    evaluations++
    return i.evaluate(applyOps(lean, opsOn(lean, opsFor(i.params, vals))).design, i.signal)
  }
  const polish = async (e: Evaluation, cams: Camera[]) => {
    const out: { cams: Camera[]; loss: number; cls: Uint8Array[] } = { cams: [], loss: 0, cls: [] }
    for (const [j, t] of work.entries()) {
      const p = await refineCamera(e, cams[j]!, t, { steps: FIT_CAMERA_STEPS, hide, stats, guard })
      out.cams.push(p.camera)
      out.loss += p.score.loss / work.length
      stats.rasters++
      out.cls.push(
        rasterize(e, cams[j]!, { width: t.view.width, height: t.view.height }, { hide }).cls,
      )
    }
    return out
  }

  const out = r.params.map((x) => ({ ...x }))
  const notes: FitResult['diagnostics'] = []
  let reset = false
  try {
    const baseEv = await evalOf(values)
    const base = await polish(
      baseEv,
      fitted.map((v) => r.cameras[v.id]!),
    )
    // The residual the fit could not remove: mask noise plus whatever the recipe cannot draw.
    const noise = Math.max(base.loss, i.noiseLoss ?? 0, 1e-6)
    for (const [j, p] of i.params.entries()) {
      const st = out[j]!
      if (st.status === 'pinned' || p.max <= p.min) continue
      if (evaluations + 2 > maxEvals) {
        notes.push({
          level: 'warning',
          code: 'match.observeSkipped',
          message: `No budget left to check "${p.key}"; its status is the fit's own.`,
        })
        continue
      }
      let rise = Infinity
      let changed = 0
      let nudged = 0
      for (const sgn of [1, -1]) {
        const y = values.slice()
        y[j] = settle(p, values[j]! + sgn * NUDGE * (p.max - p.min))
        if (y[j] === values[j]) continue
        const e = await evalOf(y)
        if (e.diagnostics.some((d) => d.level === 'error')) continue
        const n = await polish(e, base.cams)
        // At the base camera: did any pixel change at all?
        for (let v = 0; v < fitted.length; v++)
          changed = Math.max(changed, changedFraction(base.cls[v]!, n.cls[v]!))
        // The rise that is left after the camera has had its chance to absorb the change.
        rise = Math.min(rise, Math.max(0, n.loss - base.loss))
        nudged = Math.max(nudged, Math.abs(y[j]! - values[j]!))
      }
      if (!Number.isFinite(rise)) continue
      st.sensitivity = rise
      st.uncertainty = rise > 0 ? nudged * Math.sqrt((HIDE_FRACTION * noise) / rise) : Infinity
      const tolerance = Math.min(TOLERANCE, 0.25 * (p.max - p.min))
      const status =
        changed < OBSERVE_THRESHOLD ? 'assumed' : st.uncertainty > tolerance ? 'weak' : null
      if (!status) continue
      const onBound = values[j] === p.min || values[j] === p.max
      st.status = status
      if (status === 'assumed' || onBound) {
        st.value = settle(p, p.start)
        reset = reset || st.value !== values[j]
        values[j] = st.value
      }
    }
  } catch (err) {
    if (!(err instanceof Stop)) throw err
    notes.push({
      level: 'warning',
      code: 'match.observeStopped',
      message: `The visibility check was ${err.reason === 'aborted' ? 'cancelled' : 'out of budget'}; unchecked numbers keep the fit's status.`,
    })
  }
  const counted = {
    evaluations: r.evaluations + evaluations,
    rasters: r.rasters + stats.rasters,
  }
  if (!reset) return { ...r, params: out, ...counted, diagnostics: [...r.diagnostics, ...notes] }

  // Rebuild and rescore with the reset numbers back at their starts, with one camera re-polish.
  const ops = opsFor(i.params, values)
  const design = applyOps(r.design, ops).design
  const ev = await i.evaluate(withoutHidden(design, hide), i.signal)
  counted.evaluations++
  const scores = { ...r.scores }
  const cameras = { ...r.cameras }
  for (const v of fitted) {
    const t = prepareTarget(viewAt(v, FINE_PX))
    const p = await refineCamera(ev, r.cameras[v.id]!, t, { steps: FIT_CAMERA_STEPS, hide, stats })
    cameras[v.id] = p.camera
    scores[v.id] = p.score
  }
  counted.rasters = r.rasters + stats.rasters
  const fittedScores = fitted.map((v) => scores[v.id]!)
  const poor = fittedScores.some((s) => underFloor(s, i.floor))
  return {
    ...r,
    design,
    ops: [...r.ops, ...ops],
    cameras,
    scores,
    loss: fittedScores.reduce((s, x) => s + x.loss, 0) / Math.max(1, fittedScores.length),
    params: out,
    ...counted,
    quality: poor ? 'poor' : r.quality,
    stopped: poor && r.stopped === 'converged' ? 'poor' : r.stopped,
    diagnostics: [
      ...ev.diagnostics,
      ...r.diagnostics.filter((d) => d.code.startsWith('match.')),
      ...notes,
    ],
  }
}

/** The canon views ranked by how much the assumed numbers would change what they show. */
export async function suggestView(
  d: Design,
  assumed: FitParam[],
  evaluate: Evaluate,
  o: { hide?: string[] } = {},
): Promise<{ seed: ViewSeed; gain: number }[]> {
  const hide = o.hide ?? []
  const size = { width: 128, height: 128 }
  const base = await evaluate(d)
  const seeds = Object.keys(VIEW_SEEDS) as ViewSeed[]
  const cams = seeds.map((s) => defaultCamera(base, s, { hide }))
  const baseR = cams.map((c) => rasterize(base, c, size, { hide }).cls)
  const gain = seeds.map(() => 0)
  for (const p of assumed) {
    if (p.max <= p.min) continue
    const v = settle(p, p.start + NUDGE * (p.max - p.min))
    const e = await evaluate(applyOps(d, opsFor([p], [v])).design)
    if (e.diagnostics.some((x) => x.level === 'error')) continue
    cams.forEach((c, k) => {
      gain[k] = gain[k]! + changedFraction(baseR[k]!, rasterize(e, c, size, { hide }).cls)
    })
  }
  return seeds
    .map((seed, k) => ({ seed, gain: gain[k]! }))
    .sort((a, b) => b.gain - a.gain || (a.seed < b.seed ? -1 : 1))
}
