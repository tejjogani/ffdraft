/**
 * Lifting 2D stone marks onto a 3D body (plan §4, from the sculpt-first proposal): render the host
 * alone with depth and face buffers, cast the pixel's ray onto the triangle under it, and keep the
 * face normal. Stones then become ordinary `surface`-placed gems.
 */

import type { Evaluation } from '@pave/kernel/types'
import { snapToMelee } from '@pave/schema'
import { unproject } from './camera'
import { rasterize, triangleAt } from './raster'
import type { Camera, Size, StoneMark, Vec3 } from './types'

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

export function liftToSurface(
  e: Evaluation,
  c: Camera,
  size: Size,
  px: { x: number; y: number }[],
  hostNodeId: string,
): ({ point: Vec3; normal: Vec3 } | null)[] {
  const ids = new Set([...e.parts.map((p) => p.nodeId), ...e.stones.map((s) => s.nodeId)])
  const hide = [...ids].filter((id) => id !== hostNodeId)
  const r = rasterize(e, c, size, { hide, face: true, depth: true })
  const eye = unproject(c, size, size.width / 2, size.height / 2, 0)
  return px.map(({ x, y }) => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    if (ix < 0 || iy < 0 || ix >= size.width || iy >= size.height) return null
    const f = r.face![iy * size.width + ix]!
    if (f < 0) return null
    const t = triangleAt(e, f, hide)
    let normal = cross(sub(t.b, t.a), sub(t.c, t.a))
    const len = Math.hypot(...normal)
    if (len < 1e-12) return null
    normal = [normal[0] / len, normal[1] / len, normal[2] / len]
    // The exact ray through (x, y), not the pixel centre: intersect it with the face's plane.
    const dir = sub(unproject(c, size, x, y, 1), eye)
    const denom = dot(normal, dir)
    if (Math.abs(denom) < 1e-12) return null
    const s = dot(normal, sub(t.a, eye)) / denom
    const point: Vec3 = [eye[0] + s * dir[0], eye[1] + s * dir[1], eye[2] + s * dir[2]]
    // A visible face looks at the camera, whatever the mesh's winding.
    if (denom > 0) normal = [-normal[0], -normal[1], -normal[2]]
    return { point, normal }
  })
}

/** Surface-placed stones from marks that lifted; melee sizes snap to stock (4 mm and under). */
export function stonesFromMarks(
  marks: StoneMark[],
  lifts: ({ point: Vec3; normal: Vec3 } | null)[],
  mmPerPx: number,
  hostNodeId: string,
): { width: number; placement: { type: 'surface'; host: string; point: Vec3; normal: Vec3 } }[] {
  const out: {
    width: number
    placement: { type: 'surface'; host: string; point: Vec3; normal: Vec3 }
  }[] = []
  for (let i = 0; i < marks.length; i++) {
    const l = lifts[i]
    if (!l) continue
    const mm = marks[i]!.d * mmPerPx
    const width = mm <= 4 ? snapToMelee(mm) : Math.round(mm * 20) / 20
    out.push({
      width,
      placement: { type: 'surface', host: hostNodeId, point: l.point, normal: l.normal },
    })
  }
  return out
}
