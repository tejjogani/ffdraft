/**
 * What the photos could see (plan §7). A fitted number that barely changes any fitted view's
 * silhouette was not measured, only guessed: it goes back to its start and is marked assumed.
 * The same nudges, rendered from the canon views, say which second photo would help most.
 */
import type { Evaluation } from '@pave/kernel/types'
import { applyOps, type Design } from '@pave/schema'
import { defaultCamera, VIEW_SEEDS, type ViewSeed } from './camera'
import { viewAt, WORK_PX } from './fit'
import { opsFor, settle } from './params'
import { rasterize } from './raster'
import { prepareTarget, scoreView } from './score'
import type { Camera, Evaluate, FitInput, FitParam, FitResult, Size } from './types'

/** Changed pixels, as a fraction of the subject, below which a number counts as unseen. Unmeasured. */
export const OBSERVE_THRESHOLD = 0.0015
export const NUDGE = 0.1

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
  const hide = i.hide ?? []
  const fitted = i.views.filter((v) => !v.heldOut && r.cameras[v.id])
  const sizes: Size[] = fitted.map((v) => {
    const w = viewAt(v, WORK_PX)
    return { width: w.width, height: w.height }
  })
  const cams: Camera[] = fitted.map((v) => r.cameras[v.id]!)
  const values = i.params.map((p) => r.params.find((x) => x.key === p.key)?.value ?? p.start)
  // Built on the fitted design, so ops a discrete choice added before the fit are kept.
  const evalOf = (vals: number[]) =>
    i.evaluate(applyOps(r.design, opsFor(i.params, vals)).design, i.signal)
  const baseEv = await evalOf(values)
  let evaluations = 1
  let rasters = 0
  const render = (e: Evaluation, j: number) => {
    rasters++
    return rasterize(e, cams[j]!, sizes[j]!, { hide }).cls
  }
  const base = fitted.map((_, j) => render(baseEv, j))

  const out = r.params.map((x) => ({ ...x }))
  let reset = false
  for (const [j, p] of i.params.entries()) {
    const st = out[j]!
    if (st.status === 'pinned' || p.max <= p.min) continue
    let sens = 0
    for (const sgn of [1, -1]) {
      const y = values.slice()
      y[j] = settle(p, values[j]! + sgn * NUDGE * (p.max - p.min))
      if (y[j] === values[j]) continue
      const e = await evalOf(y)
      evaluations++
      if (e.diagnostics.some((d) => d.level === 'error')) continue
      for (let v = 0; v < fitted.length; v++)
        sens = Math.max(sens, changedFraction(base[v]!, render(e, v)))
    }
    st.sensitivity = sens
    if (sens < OBSERVE_THRESHOLD) {
      st.status = 'assumed'
      st.value = settle(p, p.start)
      values[j] = st.value
      reset = true
    }
  }
  if (!reset)
    return {
      ...r,
      params: out,
      evaluations: r.evaluations + evaluations,
      rasters: r.rasters + rasters,
    }

  // Rebuild and rescore with the assumed numbers back at their starts.
  const ops = opsFor(i.params, values)
  const design = applyOps(r.design, ops).design
  const ev = await i.evaluate(design, i.signal)
  evaluations++
  const scores = { ...r.scores }
  for (const v of i.views) {
    const c = r.cameras[v.id]
    if (!c) continue
    const t = prepareTarget(viewAt(v, 384))
    rasters++
    scores[v.id] = scoreView(
      rasterize(ev, c, { width: t.view.width, height: t.view.height }, { hide }),
      t,
      c,
    )
  }
  const fittedScores = fitted.map((v) => scores[v.id]!)
  return {
    ...r,
    design,
    ops: [...r.ops, ...ops],
    scores,
    loss: fittedScores.reduce((s, x) => s + x.loss, 0) / Math.max(1, fittedScores.length),
    params: out,
    evaluations: r.evaluations + evaluations,
    rasters: r.rasters + rasters,
    diagnostics: ev.diagnostics,
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
