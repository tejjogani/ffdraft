/** Planar sections: the cut outline of metal bodies at a view's clip plane, as closed loops. */
import type { SceneBody } from './hlr'
import { chainSegments, SegmentBuffer } from './polyline'
import type { ViewDef } from './views'

export interface Section {
  /** World-space cut segments, offered to hidden-line removal as visible candidates. */
  world: Float32Array
  /** Closed loops in view millimetres, for hatching. */
  loops: Float32Array[]
}

export function sliceBodies(bodies: readonly SceneBody[], view: ViewDef): Section {
  const plane = view.clipDepth ?? 0
  const [tx, ty, tz] = view.toward
  const [rx, ry, rz] = view.right
  const [ux, uy, uz] = view.up
  const world: number[] = []
  const flat = new SegmentBuffer()
  for (const b of bodies) {
    if (b.kind !== 'metal') continue
    const p = b.positions
    const idx = b.indices
    const dist = (v: number) => p[v * 3]! * tx + p[v * 3 + 1]! * ty + p[v * 3 + 2]! * tz - plane
    for (let f = 0; f < idx.length; f += 3) {
      const vs = [idx[f]!, idx[f + 1]!, idx[f + 2]!]
      const ds = vs.map(dist)
      const pts: number[] = []
      for (let k = 0; k < 3; k++) {
        const i = vs[k]!
        const j = vs[(k + 1) % 3]!
        const di = ds[k]!
        const dj = ds[(k + 1) % 3]!
        if (di < 0 === dj < 0) continue
        // Interpolate from the lower vertex index so both faces of an edge agree bit-for-bit.
        const [lo, hi, dlo, dhi] = i < j ? [i, j, di, dj] : [j, i, dj, di]
        const t = dlo / (dlo - dhi)
        for (let a = 0; a < 3; a++) pts.push(p[lo * 3 + a]! + (p[hi * 3 + a]! - p[lo * 3 + a]!) * t)
      }
      if (pts.length !== 6) continue
      world.push(...pts)
      const x0 = pts[0]! * rx + pts[1]! * ry + pts[2]! * rz
      const y0 = pts[0]! * ux + pts[1]! * uy + pts[2]! * uz
      const x1 = pts[3]! * rx + pts[4]! * ry + pts[5]! * rz
      const y1 = pts[3]! * ux + pts[4]! * uy + pts[5]! * uz
      flat.push(x0, y0, x1, y1)
    }
  }
  return { world: Float32Array.from(world), loops: chainSegments(flat, 0.002, 0.05) }
}
