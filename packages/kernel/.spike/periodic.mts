import { boot } from './boot.mts'
const { oc } = await boot()
const N = 6
const t = [0, 1, 2.5, 3, 4.2, 5, 6.5] // N+1 knots
const T = t[N] - t[0]
const poles = new oc.NCollection_Array1_gp_Pnt(1, N)
const P: number[][] = []
for (let i = 0; i < N; i++) { const p = [Math.cos(i) * 3 + i, Math.sin(i * 2) * 2, i * i * 0.1]; P.push(p); const g = new oc.gp_Pnt(p[0], p[1], p[2]); poles.SetValue(i + 1, g) }
const knots = new oc.NCollection_Array1_double(1, N + 1), mults = new oc.NCollection_Array1_int(1, N + 1)
for (let i = 0; i <= N; i++) { knots.SetValue(i + 1, t[i]); mults.SetValue(i + 1, 1) }
const curve = new oc.Geom_BSplineCurve(poles, knots, mults, 3, true)
const U = (j: number) => t[((j % N) + N) % N] + T * Math.floor(j / N)
function basis(j: number, d: number, u: number): number {
  if (d === 0) return u >= U(j) && u < U(j + 1) ? 1 : 0
  const a = U(j + d) - U(j), b = U(j + d + 1) - U(j + 1)
  return (a > 0 ? ((u - U(j)) / a) * basis(j, d - 1, u) : 0) + (b > 0 ? ((U(j + d + 1) - u) / b) * basis(j + 1, d - 1, u) : 0)
}
for (let shift = 0; shift < N; shift++) {
  let err = 0
  for (const u of [0.3, 1.7, 2.9, 3.5, 4.9, 6.1]) {
    const v = curve.Value(u)
    const q = [0, 0, 0]
    for (let j = -4; j < N + 1; j++) { const w = basis(j, 3, u); if (w) for (let k = 0; k < 3; k++) q[k] += w * P[(((j + shift) % N) + N) % N][k] }
    err = Math.max(err, Math.hypot(v.X() - q[0], v.Y() - q[1], v.Z() - q[2]))
  }
  console.log('shift', shift, 'err', err.toExponential(2))
}
