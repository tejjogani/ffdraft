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
      'stopped',
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
      r.stopped ?? '—',
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
        p.status,
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
      c.pass === null ? 'no cases' : c.pass ? 'yes' : 'NO',
    ]),
  )
}
