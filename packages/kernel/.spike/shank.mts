import { boot } from './boot.mts'
const { oc, r, mf } = await boot()

// profile: closed loop of cubic beziers in (a, rad) for width w, thickness t, inner radius Ri: rounded rect
function profile(w: number, t: number, Ri: number): number[][][] {
  const e = Math.min(w, t) * 0.25
  const k = 0.5523 * e
  const a0 = -w / 2, a1 = w / 2, r0 = Ri, r1 = Ri + t
  const line = (p: number[], q: number[]) => [p, [p[0] + (q[0] - p[0]) / 3, p[1] + (q[1] - p[1]) / 3], [p[0] + 2 * (q[0] - p[0]) / 3, p[1] + 2 * (q[1] - p[1]) / 3], q]
  return [
    line([a0 + e, r0], [a1 - e, r0]),
    [[a1 - e, r0], [a1 - e + k, r0], [a1, r0 + e - k], [a1, r0 + e]],
    line([a1, r0 + e], [a1, r1 - e]),
    [[a1, r1 - e], [a1, r1 - e + k], [a1 - e + k, r1], [a1 - e, r1]],
    line([a1 - e, r1], [a0 + e, r1]),
    [[a0 + e, r1], [a0 + e - k, r1], [a0, r1 - e + k], [a0, r1 - e]],
    line([a0, r1 - e], [a0, r0 + e]),
    [[a0, r0 + e], [a0, r0 + e - k], [a0 + e - k, r0], [a0 + e, r0]],
  ]
}
// periodic cubic interpolation: solve (c[i-1]+4c[i]+c[i+1])/6 = p[i]
function periodicSolve(p: Float64Array): Float64Array {
  const n = p.length
  // circulant solve via iterative (Gauss-Seidel converges fast as diagonally dominant)
  const c = Float64Array.from(p)
  for (let it = 0; it < 60; it++) for (let i = 0; i < n; i++) c[i] = (6 * p[i] - c[(i + n - 1) % n] - c[(i + 1) % n]) / 4
  return c
}
function build(N: number) {
  const Ri = 8.255
  const secs: number[][][][] = []
  for (let i = 0; i < N; i++) {
    const th = (i / N) * 2 * Math.PI
    const s = (1 + Math.cos(th)) / 2
    secs.push(profile(2 + 1.5 * s, 1.6 + 0.6 * s, Ri))
  }
  const nSeg = secs[0].length
  const faces: any[] = []
  const t0 = performance.now()
  for (let s = 0; s < nSeg; s++) {
    const poles = new oc.NCollection_Array2_gp_Pnt(1, N, 1, 4)
    for (let j = 0; j < 4; j++) {
      const xs = new Float64Array(N), ys = new Float64Array(N), zs = new Float64Array(N)
      for (let i = 0; i < N; i++) {
        const th = (i / N) * 2 * Math.PI
        const [a, rad] = secs[i][s][j]
        xs[i] = rad * Math.sin(th); ys[i] = a; zs[i] = rad * Math.cos(th)
      }
      const cx = periodicSolve(xs), cy = periodicSolve(ys), cz = periodicSolve(zs)
      for (let i = 0; i < N; i++) { const p = new oc.gp_Pnt(cx[i], cy[i], cz[i]); poles.SetValue(i + 1, j + 1, p); p.delete() }
    }
    const uk = new oc.NCollection_Array1_double(1, N + 1), um = new oc.NCollection_Array1_int(1, N + 1)
    for (let i = 0; i <= N; i++) { uk.SetValue(i + 1, i); um.SetValue(i + 1, 1) }
    const vk = new oc.NCollection_Array1_double(1, 2), vm = new oc.NCollection_Array1_int(1, 2)
    vk.SetValue(1, 0); vk.SetValue(2, 1); vm.SetValue(1, 4); vm.SetValue(2, 4)
    const surf = new oc.Geom_BSplineSurface(poles, uk, vk, um, vm, 3, 3, true, false)
    const h = surf
    const mk = new oc.BRepBuilderAPI_MakeFace(h, 1e-6)
    faces.push(mk.Face())
    for (const d of [poles, uk, um, vk, vm, mk]) d.delete()
  }
  const t1 = performance.now()
  const sew = new oc.BRepBuilderAPI_Sewing(1e-5, true, true, true, false)
  for (const f of faces) sew.Add(f)
  sew.Perform()
  const shell = sew.SewedShape()
  const t2 = performance.now()
  const cast = r.cast(shell)
  console.log('sewn type', cast.constructor.name)
  const solid = r.makeSolid([cast as any])
  const t3 = performance.now()
  console.log('faces ms', t1 - t0, 'sew', t2 - t1, 'solid', t3 - t2)
  return solid
}
for (const N of [48, 72]) {
  const s = build(N)
  let t = performance.now()
  const v = r.measureVolume(s)
  console.log('N', N, 'vol', v, 'ms', performance.now() - t)
  t = performance.now()
  const m = s.mesh({ tolerance: 0.02, angularTolerance: 0.35 })
  console.log('mesh draft tris', m.triangles.length / 3, 'ms', performance.now() - t)
  const s2 = build(N)
  t = performance.now()
  const m2 = s2.mesh({ tolerance: 0.005, angularTolerance: 0.15 })
  console.log('mesh prod tris', m2.triangles.length / 3, 'ms', performance.now() - t)
  t = performance.now()
  const ms = s2.meshShape({ tolerance: 0.005, angularTolerance: 0.15 })
  console.log('manifold ok', ms.volume(), performance.now() - t)
  const an = new oc.BRepCheck_Analyzer(s.wrapped, true, false)
  console.log('valid', an.IsValid())
  // bore check
  const bb = s.boundingBox
  console.log(bb.bounds)
}
