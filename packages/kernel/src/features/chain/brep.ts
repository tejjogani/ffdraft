/**
 * Exact wire links for STEP: a round wire swept along a periodic B-spline through the same
 * centreline samples the mesh uses, ground flat where the link is diamond-cut. Built only when
 * an exporter asks for the B-rep.
 */
import { type Shape3D, cast, makeBox } from 'replicad'
import { runtime } from '../../core'
import { occtError, scoped } from '../../solid/occt'

/** Closed centreline (rows of xyz) → solid round wire of `radius`, cut to |z| ≤ flat. */
export function wireLoopBrep(points: Float64Array, radius: number, flat?: number): Shape3D {
  const { oc } = runtime()
  const n = points.length / 3
  const swept = scoped((own) => {
    const array = own(new oc.NCollection_HArray1_gp_Pnt(1, n))
    for (let i = 0; i < n; i++)
      array.SetValue(i + 1, own(new oc.gp_Pnt(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!)))
    const interpolation = own(new oc.GeomAPI_Interpolate(array, true, 1e-7))
    interpolation.Perform()
    if (!interpolation.IsDone()) throw new Error('Link centreline could not be interpolated')
    const spine = own(new oc.BRepBuilderAPI_MakeWire(own(new oc.BRepBuilderAPI_MakeEdge(interpolation.Curve())).Edge())).Wire()
    const [x0, y0, z0] = [points[0]!, points[1]!, points[2]!]
    const tx = points[3]! - points[(n - 1) * 3]!
    const ty = points[4]! - points[(n - 1) * 3 + 1]!
    const tz = points[5]! - points[(n - 1) * 3 + 2]!
    const axis = own(new oc.gp_Ax2(own(new oc.gp_Pnt(x0, y0, z0)), own(new oc.gp_Dir(tx, ty, tz))))
    const circle = own(new oc.gp_Circ(axis, radius))
    const profile = own(new oc.BRepBuilderAPI_MakeWire(own(new oc.BRepBuilderAPI_MakeEdge(circle)).Edge())).Wire()
    const pipe = own(new oc.BRepOffsetAPI_MakePipeShell(spine))
    pipe.SetMode(false) // corrected Frenet: no twist build-up around a closed spine
    pipe.Add(profile, false, false)
    try {
      pipe.Build(own(new oc.Message_ProgressRange()))
      pipe.MakeSolid()
    } catch (error) {
      throw occtError(error, 'Sweeping a chain link')
    }
    return cast(pipe.Shape()) as Shape3D
  })
  if (flat === undefined) return swept
  const reach = 1e3
  const slab = makeBox([-reach, -reach, -flat], [reach, reach, flat])
  try {
    return swept.intersect(slab)
  } finally {
    slab.delete()
    swept.delete()
  }
}
