/**
 * Pass thresholds (plan §12). A floor fails CI and is what the prototype met on `solitaire`; a
 * target is the unverified goal before the server job ships. Other recipes start from the same
 * floors: a miss is a finding to report, not a number to relax. A floor changes only with a
 * written reason here.
 *
 * Changes to floors:
 * - 2026-11-24, camera direction: the plan's degree floor (median ≤ 2°, worst ≤ 5°) is measured
 *   as a reprojection instead, because an angle cannot tell a symmetric twin from a miss (it
 *   reported 16.9° for an eternity ring that overlaps at 0.956, and cannot handle a plain band).
 *   Converted by measurement (solitaire, plain band and eternity at the benchmark's framing): a 1°
 *   turn reads 0.1 to 0.23 %, 15° reads 0.8 to 1.3 % (nearest-point distances saturate as points
 *   slide along the piece), so 2° ≈ 0.3 % and 5° ≈ 0.8 %: median ≤ 0.3 %, worst ≤ 0.8 % of the side.
 * - 2026-11-24, status honesty: `clamped` numbers count beside `fitted` ones (a number clamped at
 *   the wrong bound was left out before), and numbers marked `weak` count as not measured, like
 *   `assumed`. The top-only check of the plan (head height assumed in top-only cases) is added.
 *
 * Every floor is judged only on the cases run. "floor met" on the six pull-request cases says
 * nothing about the grid; `recipeTable` and a grid run say per recipe what misses.
 */
import type { CaseResult } from './run'

export interface Check {
  measure: string
  value: string
  floor: string
  target: string
  pass: boolean | null // null: not enough cases to judge
  cases: number
}

const median = (xs: number[]) => {
  if (!xs.length) return Number.NaN
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : Number.NaN)
const min = (xs: number[]) => (xs.length ? Math.min(...xs) : Number.NaN)
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a')
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)} %` : 'n/a')

/** Statuses that claim a measurement: the number is reported as read from the photos. */
const MEASURED = new Set(['fitted', 'clamped'])
/** Statuses that say "not observable from these photos". */
const UNSEEN = new Set(['assumed', 'weak'])

export function checkThresholds(all: CaseResult[]): Check[] {
  const ok = all.filter((r) => !r.threw && r.level !== 'misspec')
  const misspec = all.filter((r) => !r.threw && r.level === 'misspec')
  const clean = ok.filter((r) => r.level === 'clean')
  const one = clean.filter((r) => r.viewSet === 'one')
  const two = clean.filter((r) => r.viewSet === 'two')
  const noisy = ok.filter((r) => r.level === 'noisy')
  const hard = ok.filter((r) => r.level === 'hard')
  const out: Check[] = []
  const add = (
    measure: string,
    cases: CaseResult[],
    value: string,
    floor: string,
    target: string,
    pass: boolean,
  ) =>
    out.push({
      measure,
      value,
      floor,
      target,
      pass: cases.length ? pass : null,
      cases: cases.length,
    })

  const cam = one.map((r) => r.reprojPct).filter((x): x is number => x !== null)
  add(
    'Camera reprojection, one view (% of side)',
    one,
    `median ${f(median(cam), 2)}, worst ${f(max(cam), 2)}`,
    'median ≤ 0.3, worst ≤ 0.8 (from 2°, 5°)',
    'median ≤ 0.15',
    median(cam) <= 0.3 && max(cam) <= 0.8,
  )

  const disc = clean.filter((r) => r.discrete)
  const right = disc.filter(
    (r) => r.discrete!.decided && r.discrete!.picked === r.discrete!.truth,
  ).length
  const wrong = disc.filter(
    (r) => r.discrete!.decided && r.discrete!.picked !== r.discrete!.truth,
  ).length
  const asked = disc.filter((r) => !r.discrete!.decided).length
  add(
    'Discrete: decided right / decided wrong / question',
    disc,
    `${pct(right, disc.length)} / ${pct(wrong, disc.length)} / ${pct(asked, disc.length)}`,
    '≥ 90 % / ≤ 2 % / ≤ 20 %',
    '≥ 95 % / 0 / ≤ 10 %',
    right >= 0.9 * disc.length && wrong <= 0.02 * disc.length && asked <= 0.2 * disc.length,
  )

  // Sizes in mm: only parameters whose unit is mm (all bench keys are).
  const sizes = (rs: CaseResult[], pick: (p: CaseResult['params'][number]) => boolean) =>
    rs.flatMap((r) => r.params.filter(pick).map((p) => p.errMm))
  const inPlane = sizes(one, (p) => !p.depthLike)
  add(
    'In-plane sizes, one view (mm)',
    one,
    `median ${f(median(inPlane))}, worst ${f(max(inPlane))}`,
    'median ≤ 0.15, worst ≤ 0.6',
    'median ≤ 0.1, worst ≤ 0.3',
    median(inPlane) <= 0.15 && max(inPlane) <= 0.6,
  )
  const depth = sizes(one, (p) => p.depthLike && !UNSEEN.has(p.status))
  add(
    'Depth-like sizes, one view, not marked assumed or weak (mm)',
    one,
    `median ${f(median(depth))}, worst ${f(max(depth))}`,
    'median ≤ 0.5, worst ≤ 1.0',
    'median ≤ 0.3',
    !depth.length || (median(depth) <= 0.5 && max(depth) <= 1),
  )
  const all2 = sizes(two, () => true)
  add(
    'All sizes, two views (mm)',
    two,
    `median ${f(median(all2))}, worst ${f(max(all2))}`,
    'median ≤ 0.25, worst ≤ 0.6',
    'median ≤ 0.1, worst ≤ 0.3',
    median(all2) <= 0.25 && max(all2) <= 0.6,
  )

  const iou1 = one.flatMap((r) => r.iouAfter)
  add(
    'Fitted-view overlap, one view',
    one,
    `median ${f(median(iou1), 3)}, min ${f(min(iou1), 3)}`,
    'median ≥ 0.95, min ≥ 0.93',
    'median ≥ 0.98',
    median(iou1) >= 0.95 && min(iou1) >= 0.93,
  )
  const iou2 = two.flatMap((r) => r.iouAfter)
  add(
    'Fitted-view overlap, two views',
    two,
    `median ${f(median(iou2), 3)}, min ${f(min(iou2), 3)}`,
    'median ≥ 0.92, min ≥ 0.87',
    'median ≥ 0.98',
    median(iou2) >= 0.92 && min(iou2) >= 0.87,
  )
  const h1 = one.map((r) => r.heldOutIou).filter((x): x is number => x !== null)
  add(
    'Held-out overlap, one view',
    one,
    `median ${f(median(h1), 3)}, min ${f(min(h1), 3)}`,
    'median ≥ 0.92, min ≥ 0.85',
    'median ≥ 0.96',
    median(h1) >= 0.92 && min(h1) >= 0.85,
  )
  const h2 = two.map((r) => r.heldOutIou).filter((x): x is number => x !== null)
  add(
    'Held-out overlap, two views',
    two,
    `median ${f(median(h2), 3)}, min ${f(min(h2), 3)}`,
    'median ≥ 0.94, min ≥ 0.88',
    'median ≥ 0.96',
    median(h2) >= 0.94 && min(h2) >= 0.88,
  )

  const w1 = one.map((r) => r.weightErrPct)
  add(
    'Metal weight error, one view (%)',
    one,
    `median ${f(median(w1), 1)}, worst ${f(max(w1), 1)}`,
    'median ≤ 8, worst ≤ 25',
    '',
    median(w1) <= 8 && max(w1) <= 25,
  )
  const w2 = two.map((r) => r.weightErrPct)
  add(
    'Metal weight error, two views (%)',
    two,
    `median ${f(median(w2), 1)}, worst ${f(max(w2), 1)}`,
    'median ≤ 6, worst ≤ 12',
    'worst ≤ 5',
    median(w2) <= 6 && max(w2) <= 12,
  )
  const c1 = one.map((r) => r.caratErrPct).filter((x): x is number => x !== null)
  add(
    'Carat error, one view (%)',
    one,
    `median ${f(median(c1), 1)}, worst ${f(max(c1), 1)}`,
    'median ≤ 5, worst ≤ 20',
    '',
    !c1.length || (median(c1) <= 5 && max(c1) <= 20),
  )
  const c2 = two.map((r) => r.caratErrPct).filter((x): x is number => x !== null)
  add(
    'Carat error, two views (%)',
    two,
    `worst ${f(max(c2), 1)}`,
    'worst ≤ 6',
    'worst ≤ 3',
    !c2.length || max(c2) <= 6,
  )

  const ns = sizes(noisy, () => true)
  const nd = noisy.filter((r) => r.discrete)
  const nRight = nd.filter(
    (r) => r.discrete!.decided && r.discrete!.picked === r.discrete!.truth,
  ).length
  const nIou = noisy.flatMap((r) => r.iouAfter)
  add(
    'noisy: any size (mm) / discrete right / fitted overlap',
    noisy,
    `worst ${f(max(ns))} / ${pct(nRight, nd.length)} / median ${f(median(nIou), 3)}`,
    'worst ≤ 0.7 / ≥ 90 % / median ≥ 0.86',
    'worst ≤ 0.4',
    max(ns) <= 0.7 && (!nd.length || nRight >= 0.9 * nd.length) && median(nIou) >= 0.86,
  )
  const hWrong = hard.filter(
    (r) => r.discrete?.decided && r.discrete.picked !== r.discrete.truth,
  ).length
  add(
    'hard: invalid builds / decided wrong',
    hard,
    `${hard.filter((r) => r.invalid).length} / ${pct(hWrong, hard.filter((r) => r.discrete).length)}`,
    '0 / ≤ 10 %',
    '',
    hard.every((r) => !r.invalid) &&
      hWrong <= 0.1 * Math.max(1, hard.filter((r) => r.discrete).length),
  )

  add(
    'Invalid builds after a fit; fits that throw',
    all,
    `${ok.filter((r) => r.invalid).length}; ${all.filter((r) => r.threw).length}`,
    '0; 0',
    '',
    ok.every((r) => !r.invalid) && all.every((r) => !r.threw),
  )

  // Per candidate: a case fits every discrete option, so divide by the candidates.
  const perCand = ok.map((r) => r.evaluations / Math.max(1, r.discrete ? 2 : 1))
  const rpv = ok.map((r) => r.rastersPerView)
  add(
    'Budget per candidate: kernel evaluations; renders per view',
    ok,
    `max ${f(max(perCand), 0)}; max ${f(max(rpv), 0)}`,
    '≤ 250; ≤ 12,000',
    '≤ 10 s per candidate',
    max(perCand) <= 250 && max(rpv) <= 12_000,
  )

  const fitted = ok.flatMap((r) => r.params.filter((p) => MEASURED.has(p.status)))
  const honest = fitted.filter((p) => p.errMm <= 0.6).length
  add(
    'Status honesty: numbers marked fitted or clamped within 0.6 mm',
    ok,
    `${pct(honest, fitted.length)} of ${fitted.length}`,
    '≥ 90 %',
    '≥ 95 %',
    honest >= 0.9 * fitted.length,
  )
  const top = ok.filter((r) => r.viewSet === 'top')
  const heights = top.flatMap((r) => r.params.filter((p) => p.key === 'center.placement.elevation'))
  const hidden = heights.filter((p) => UNSEEN.has(p.status)).length
  add(
    'Status honesty: head height assumed or weak in top-only cases',
    top.filter((r) => r.params.some((p) => p.key === 'center.placement.elevation')),
    `${pct(hidden, heights.length)} of ${heights.length}`,
    '≥ 90 %',
    '',
    hidden >= 0.9 * heights.length,
  )
  // Reported only: how much the photos could not see, per view set.
  const unseen = (rs: CaseResult[]) => {
    const ps = rs.flatMap((r) => r.params.filter((p) => p.status !== 'pinned'))
    return `${ps.filter((p) => UNSEEN.has(p.status)).length} of ${ps.length}`
  }
  out.push({
    measure: 'Not observable (assumed or weak): one / two / top views',
    value: `${unseen(ok.filter((r) => r.viewSet === 'one'))} / ${unseen(ok.filter((r) => r.viewSet === 'two'))} / ${unseen(top)}`,
    floor: 'reported',
    target: '',
    pass: null,
    cases: ok.length,
  })
  const poor = ok.filter((r) => r.quality !== 'good').length
  out.push({
    measure: 'Fits reported poor or failed (closed-world levels)',
    value: `${poor} of ${ok.length}`,
    floor: 'reported',
    target: '',
    pass: null,
    cases: ok.length,
  })
  if (misspec.length) {
    const mFitted = misspec.flatMap((r) => r.params.filter((p) => MEASURED.has(p.status)))
    const mHonest = mFitted.filter((p) => p.errMm <= 0.6).length
    const flagged = misspec.filter((r) => r.quality !== 'good').length
    const mSizes = sizes(misspec, (p) => MEASURED.has(p.status))
    out.push({
      measure: 'misspec: poor or failed; measured within 0.6 mm; worst measured size; worst weight',
      value: `${flagged} of ${misspec.length}; ${pct(mHonest, mFitted.length)} of ${mFitted.length}; ${f(max(mSizes))} mm; ${f(max(misspec.map((r) => r.weightErrPct)), 1)} %`,
      floor: 'reported',
      target: 'measured within 0.6 mm ≥ 90 %',
      pass: null,
      cases: misspec.length,
    })
  }
  return out
}

/**
 * The plan's speed floors, from timings the CLI takes: one render plus score at 192 px of a piece
 * of about 10k triangles, and a camera search from scratch. Wall time on a shared machine.
 */
export function speedChecks(renderMs: number, poseMs: number, triangles: number): Check[] {
  return [
    {
      measure: `Speed: render plus score, 192 px, ${triangles} triangles (ms)`,
      value: f(renderMs, 2),
      floor: '≤ 4',
      target: '',
      pass: renderMs <= 4,
      cases: 1,
    },
    {
      measure: 'Speed: camera search from scratch (s)',
      value: f(poseMs / 1000, 1),
      floor: '≤ 4',
      target: '',
      pass: poseMs <= 4000,
      cases: 1,
    },
  ]
}
