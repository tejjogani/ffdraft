/** Plain-text tables of benchmark results: per case, per parameter, and the threshold checks. */
import type { CaseResult } from './run'
import type { Check } from './thresholds'

const f = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d)

function table(head: string[], rows: string[][]): string {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const line = (r: string[]) => `| ${r.map((c, i) => c.padEnd(w[i]!)).join(' | ')} |`
  return [line(head), `|${w.map((n) => '-'.repeat(n + 2)).join('|')}|`, ...rows.map(line)].join(
    '\n',
  )
}

export function caseTable(rs: CaseResult[]): string {
  return table(
    [
      'case',
      'IoU before',
      'IoU after',
      'held-out',
      'cam °',
      'discrete',
      'weight %',
      'carat %',
      'evals',
      'renders/view',
      's',
      'reproj %',
      'stopped',
      'quality',
      'failure',
    ],
    rs.map((r) => [
      r.id,
      r.iouBefore.map((x) => f(x, 3)).join('/'),
      r.iouAfter.map((x) => f(x, 3)).join('/'),
      f(r.heldOutIou, 3),
      f(r.cameraErrDeg, 1),
      r.discrete
        ? `${r.discrete.truth}→${r.discrete.picked}${r.discrete.decided ? '' : '?'} ×${f(r.discrete.margin, 2)}`
        : '—',
      f(r.weightErrPct, 1),
      f(r.caratErrPct, 1),
      String(r.evaluations),
      f(r.rastersPerView, 0),
      f(r.ms / 1000, 1),
      f(r.reprojPct, 2),
      r.stopped ?? '—',
      r.quality ?? '—',
      r.threw ? `threw: ${r.threw.split('\n')[0]}` : r.invalid ? 'invalid build' : '',
    ]),
  )
}

export function paramTable(rs: CaseResult[]): string {
  return table(
    [
      'case',
      'parameter',
      'truth',
      'start',
      'fitted',
      'error mm',
      'error %',
      'status',
      'depth-like',
    ],
    rs.flatMap((r) =>
      r.params.map((p) => [
        r.id,
        p.key,
        f(p.truth),
        f(p.start),
        f(p.value),
        f(p.errMm),
        f(p.errPct, 1),
        p.status === 'weak' || p.status === 'assumed' ? `${p.status} (not observable)` : p.status,
        p.depthLike ? 'yes' : '',
      ]),
    ),
  )
}

export function checkTable(cs: Check[]): string {
  return table(
    ['measure', 'cases', 'value', 'floor', 'target', 'floor met'],
    cs.map((c) => [
      c.measure,
      String(c.cases),
      c.value,
      c.floor,
      c.target,
      c.pass === null ? (c.floor === 'reported' ? 'reported' : 'no cases') : c.pass ? 'yes' : 'NO',
    ]),
  )
}

const med = (xs: number[]) => {
  if (!xs.length) return Number.NaN
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const worst = (xs: number[]) => (xs.length ? Math.max(...xs) : Number.NaN)

/**
 * Per recipe, view set and level: so a floor "met" overall cannot hide a recipe that misses it.
 * Sizes are over numbers reported as measured (fitted or clamped); "not obs." counts the numbers
 * marked assumed or weak.
 */
export function recipeTable(rs: CaseResult[]): string {
  const groups = new Map<string, CaseResult[]>()
  for (const r of rs) {
    const k = `${r.templateId}/${r.viewSet}/${r.level}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return table(
    [
      'recipe / views / level',
      'cases',
      'IoU after (min)',
      'measured size mm (median / worst)',
      'not obs.',
      'weight % (worst)',
      'carat % (worst)',
      'discrete right / wrong / asked',
      'poor / failed',
      'threw',
    ],
    [...groups].map(([k, g]) => {
      const ok = g.filter((r) => !r.threw)
      const sizes = ok.flatMap((r) =>
        r.params.filter((p) => p.status === 'fitted' || p.status === 'clamped').map((p) => p.errMm),
      )
      const unseen = ok.flatMap((r) =>
        r.params.filter((p) => p.status === 'assumed' || p.status === 'weak'),
      ).length
      const d = ok.filter((r) => r.discrete)
      const right = d.filter((r) => r.discrete!.decided && r.discrete!.picked === r.discrete!.truth)
      const wrong = d.filter((r) => r.discrete!.decided && r.discrete!.picked !== r.discrete!.truth)
      const asked = d.filter((r) => !r.discrete!.decided)
      const carats = ok.map((r) => r.caratErrPct).filter((x): x is number => x !== null)
      return [
        k,
        String(g.length),
        f(Math.min(...ok.flatMap((r) => r.iouAfter)), 3),
        `${f(med(sizes))} / ${f(worst(sizes))}`,
        String(unseen),
        f(worst(ok.map((r) => r.weightErrPct)), 1),
        f(worst(carats), 1),
        d.length ? `${right.length} / ${wrong.length} / ${asked.length}` : '—',
        `${ok.filter((r) => r.quality === 'poor').length} / ${ok.filter((r) => r.quality === 'failed').length}`,
        String(g.length - ok.length),
      ]
    }),
  )
}
