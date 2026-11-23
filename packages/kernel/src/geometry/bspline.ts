/**
 * C² cubic B-spline interpolation through a sequence of points, open (clamped, natural ends)
 * or closed (periodic). The same knots and poles are handed to OpenCascade for the exact
 * surface and evaluated here for the analytic mesh, so both describe one curve.
 */

/** The four basis weights (and their u-derivatives) that are non-zero at a parameter. */
export interface BasisAt {
  /** Index of the first of four consecutive poles (wrap with `% poleCount` when periodic). */
  first: number
  w: [number, number, number, number]
  dw: [number, number, number, number]
}

export interface CubicSpline {
  periodic: boolean
  /** Distinct knots: the interpolation parameters (periodic: one extra, the period's end). */
  knots: number[]
  /** Multiplicity of each knot, as OpenCascade wants them. */
  multiplicities: number[]
  poleCount: number
  /** Poles for `dim`-dimensional points given row by row; returns `poleCount` rows. */
  solve(points: Float64Array, dim: number): Float64Array
  /** Basis at `u`, within the knot range. */
  basisAt(u: number): BasisAt
}

/**
 * OpenCascade numbers the poles of a periodic curve so that the basis function starting at
 * knot j weights pole j + 3 (verified against Geom_BSplineCurve in bspline.test.ts).
 */
const PERIODIC_POLE_SHIFT = 3

/** Cox–de Boor on a flat knot accessor: weights and derivative weights of N_{span-3..span}. */
function cubicBasis(U: (j: number) => number, span: number, u: number, out: BasisAt): void {
  // The NURBS Book A2.2, unrolled for degree 3, plus first derivatives from the degree-2 row.
  const left = [0, u - U(span), u - U(span - 1), u - U(span - 2)]
  const right = [0, U(span + 1) - u, U(span + 2) - u, U(span + 3) - u]
  const n = [1, 0, 0, 0]
  const quadratic = [0, 0, 0]
  for (let j = 1; j <= 3; j++) {
    if (j === 3) for (let k = 0; k < 3; k++) quadratic[k] = n[k]!
    let saved = 0
    for (let r = 0; r < j; r++) {
      const denom = right[r + 1]! + left[j - r]!
      const temp = denom > 0 ? n[r]! / denom : 0
      n[r] = saved + right[r + 1]! * temp
      saved = left[j - r]! * temp
    }
    n[j] = saved
  }
  for (let k = 0; k < 4; k++) {
    // N'_{i,3} = 3·(N_{i,2}/(U_{i+3}−U_i) − N_{i+1,2}/(U_{i+4}−U_{i+1}))
    const i = span - 3 + k
    const a = U(i + 3) - U(i)
    const b = U(i + 4) - U(i + 1)
    const lower = k > 0 && a > 0 ? quadratic[k - 1]! / a : 0
    const upper = k < 3 && b > 0 ? quadratic[k]! / b : 0
    out.w[k] = n[k]!
    out.dw[k] = 3 * (lower - upper)
  }
}

/** Solves A·X = B in place for a small dense system; B has `cols` columns per row. */
function solveDense(a: Float64Array, b: Float64Array, n: number, cols: number): void {
  for (let i = 0; i < n; i++) {
    let pivot = i
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r * n + i]!) > Math.abs(a[pivot * n + i]!)) pivot = r
    if (pivot !== i) {
      for (let c = 0; c < n; c++) [a[i * n + c], a[pivot * n + c]] = [a[pivot * n + c]!, a[i * n + c]!]
      for (let c = 0; c < cols; c++) [b[i * cols + c], b[pivot * cols + c]] = [b[pivot * cols + c]!, b[i * cols + c]!]
    }
    const d = a[i * n + i]!
    for (let r = i + 1; r < n; r++) {
      const f = a[r * n + i]! / d
      if (f === 0) continue
      for (let c = i; c < n; c++) a[r * n + c]! -= f * a[i * n + c]!
      for (let c = 0; c < cols; c++) b[r * cols + c]! -= f * b[i * cols + c]!
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let c = 0; c < cols; c++) {
      let s = b[i * cols + c]!
      for (let k = i + 1; k < n; k++) s -= a[i * n + k]! * b[k * cols + c]!
      b[i * cols + c] = s / a[i * n + i]!
    }
  }
}

const newBasis = (): BasisAt => ({ first: 0, w: [0, 0, 0, 0], dw: [0, 0, 0, 0] })

/** Index i with knots[i] ≤ u < knots[i+1], clamped to the last interval. */
function interval(knots: readonly number[], u: number): number {
  let lo = 0
  let hi = knots.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (knots[mid]! <= u) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Spline through points at strictly increasing parameters `params`. Closed splines take one
 * parameter more than there are points: the last is where the curve returns to the first point.
 */
export function cubicSpline(params: readonly number[], closed: boolean): CubicSpline {
  return closed ? periodicSpline(params) : clampedSpline(params)
}

function periodicSpline(t: readonly number[]): CubicSpline {
  const n = t.length - 1
  if (n < 3) throw new Error('A closed spline needs at least three points')
  const period = t[n]! - t[0]!
  const U = (j: number): number => t[((j % n) + n) % n]! + period * Math.floor(j / n)
  const pole = (j: number): number => (((j + PERIODIC_POLE_SHIFT) % n) + n) % n
  const basisAt = (u: number): BasisAt => {
    const out = newBasis()
    const span = interval(t, u)
    cubicBasis(U, span, u, out)
    out.first = pole(span - 3)
    return out
  }
  return {
    periodic: true,
    knots: [...t],
    multiplicities: t.map(() => 1),
    poleCount: n,
    basisAt,
    solve(points, dim) {
      const a = new Float64Array(n * n)
      for (let i = 0; i < n; i++) {
        const b = basisAt(t[i]!)
        for (let k = 0; k < 4; k++) a[i * n + ((b.first + k) % n)]! += b.w[k]!
      }
      const x = points.slice()
      solveDense(a, x, n, dim)
      return x
    },
  }
}

function clampedSpline(t: readonly number[]): CubicSpline {
  const n = t.length - 1
  if (n < 1) throw new Error('A spline needs at least two points')
  const count = n + 3
  // Flat knots: both ends repeated four times.
  const U = (j: number): number => t[Math.min(n, Math.max(0, j - 3))]!
  const basisAt = (u: number): BasisAt => {
    const out = newBasis()
    const span = interval(t, u) + 3
    cubicBasis(U, span, u, out)
    out.first = span - 3
    return out
  }
  return {
    periodic: false,
    knots: [...t],
    multiplicities: t.map((_, i) => (i === 0 || i === n ? 4 : 1)),
    poleCount: count,
    basisAt,
    solve(points, dim) {
      const a = new Float64Array(count * count)
      const x = new Float64Array(count * dim)
      // Row 0 and row n+2: natural ends (zero second derivative), written on the end poles:
      // S''(t0) ∝ P0·α − P1·(α+β) + P2·β with weights from the first knot spans.
      const natural = (row: number, p0: number, step: number, h1: number, h2: number) => {
        a[row * count + p0] = h1 + h2
        a[row * count + p0 + step] = -(2 * h1 + h2)
        a[row * count + p0 + 2 * step] = h1
      }
      const h = (i: number) => t[Math.min(n, i + 1)]! - t[Math.min(n, i)]!
      natural(0, 0, 1, h(0), n > 1 ? h(1) : 0)
      natural(count - 1, count - 1, -1, h(n - 1), n > 1 ? h(n - 2) : 0)
      for (let i = 0; i <= n; i++) {
        const b = basisAt(t[i]!)
        for (let k = 0; k < 4; k++) a[(i + 1) * count + b.first + k]! += b.w[k]!
        for (let c = 0; c < dim; c++) x[(i + 1) * dim + c] = points[i * dim + c]!
      }
      solveDense(a, x, count, dim)
      return x
    },
  }
}

/** Chord-length parameters for a row-major array of points; closed adds the wrap-around span. */
export function chordParameters(points: Float64Array, dim: number, closed: boolean): number[] {
  const n = points.length / dim
  const params = [0]
  const span = (i: number, j: number): number => {
    let s = 0
    for (let c = 0; c < dim; c++) s += (points[i * dim + c]! - points[j * dim + c]!) ** 2
    return Math.sqrt(s)
  }
  for (let i = 1; i < n; i++) params.push(params[i - 1]! + Math.max(span(i, i - 1), 1e-9))
  if (closed) params.push(params[n - 1]! + Math.max(span(0, n - 1), 1e-9))
  return params
}
