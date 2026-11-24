/**
 * A small z-buffered software rasteriser for kernel output: metal parts are class 1, instanced
 * stones class 2. Pixel-centre sampling, no anti-aliasing, no back-face culling (draft meshes may
 * be open). It is the inner loop of every fit, so the world-space geometry of an evaluation is
 * flattened once and cached; each render only projects vertices and fills triangles.
 */
import type { Evaluation } from '@pave/kernel/types'
import { cameraBasis } from './camera'
import type { Camera, LabelRaster, Size, Stats, Vec3 } from './types'

interface Flat {
  /** World positions, xyz per vertex. */
  pos: Float64Array
  /** Three vertex indices per triangle. */
  tri: Uint32Array
  /** Class per triangle: 1 metal, 2 stone. */
  cls: Uint8Array
  /** Node index + 1 per triangle. */
  node: Uint16Array
  nodeIds: string[]
}

const cache = new WeakMap<Evaluation, Map<string, Flat>>()

function flatten(e: Evaluation, hide: readonly string[]): Flat {
  const key = [...hide].sort().join('\u0000')
  let byHide = cache.get(e)
  if (!byHide) {
    byHide = new Map()
    cache.set(e, byHide)
  }
  const hit = byHide.get(key)
  if (hit) return hit

  const hidden = new Set(hide)
  const nodeIds: string[] = []
  const nodeIndex = new Map<string, number>()
  const indexOf = (id: string) => {
    let i = nodeIndex.get(id)
    if (i === undefined) {
      i = nodeIds.length
      nodeIds.push(id)
      nodeIndex.set(id, i)
    }
    return i + 1
  }
  let nv = 0
  let nt = 0
  const parts = e.parts.filter((p) => !hidden.has(p.nodeId))
  const stones = e.stones.filter((s) => !hidden.has(s.nodeId) && e.gemMeshes[s.meshKey])
  for (const p of parts) {
    nv += p.mesh.positions.length / 3
    nt += p.mesh.indices.length / 3
  }
  for (const s of stones) {
    const g = e.gemMeshes[s.meshKey]!
    nv += g.positions.length / 3
    nt += g.indices.length / 3
  }
  const pos = new Float64Array(nv * 3)
  const tri = new Uint32Array(nt * 3)
  const cls = new Uint8Array(nt)
  const node = new Uint16Array(nt)
  let v = 0
  let t = 0
  const add = (
    positions: Float32Array,
    indices: Uint32Array,
    c: number,
    n: number,
    m?: number[],
  ) => {
    const base = v
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]!
      const y = positions[i + 1]!
      const z = positions[i + 2]!
      if (m) {
        // Column-major 4×4.
        pos[v * 3] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
        pos[v * 3 + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
        pos[v * 3 + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
      } else {
        pos[v * 3] = x
        pos[v * 3 + 1] = y
        pos[v * 3 + 2] = z
      }
      v++
    }
    for (let i = 0; i < indices.length; i += 3) {
      tri[t * 3] = base + indices[i]!
      tri[t * 3 + 1] = base + indices[i + 1]!
      tri[t * 3 + 2] = base + indices[i + 2]!
      cls[t] = c
      node[t] = n
      t++
    }
  }
  for (const p of parts) add(p.mesh.positions, p.mesh.indices, 1, indexOf(p.nodeId))
  for (const s of stones) {
    const g = e.gemMeshes[s.meshKey]!
    add(g.positions, g.indices, 2, indexOf(s.nodeId), s.matrix)
  }
  const flat = { pos, tri, cls, node, nodeIds }
  byHide.set(key, flat)
  return flat
}

/** The world triangle behind a `face` index of a raster drawn with the same `hide` list. */
export function triangleAt(
  e: Evaluation,
  face: number,
  hide: readonly string[] = [],
): { nodeId: string; a: Vec3; b: Vec3; c: Vec3 } {
  const f = flatten(e, hide)
  const v = (i: number): Vec3 => {
    const k = f.tri[face * 3 + i]! * 3
    return [f.pos[k]!, f.pos[k + 1]!, f.pos[k + 2]!]
  }
  return { nodeId: f.nodeIds[f.node[face]! - 1]!, a: v(0), b: v(1), c: v(2) }
}

/** World positions (xyz per vertex) of what a render with the same `hide` list draws. Read only. */
export function worldVertices(e: Evaluation, hide: readonly string[] = []): Float64Array {
  return flatten(e, hide).pos
}

/** Number of triangles a render would draw. */
export function triangleCount(e: Evaluation, hide: readonly string[] = []): number {
  return flatten(e, hide).cls.length
}

/**
 * Per-render work buffers, grown as needed and never returned: a render never yields, so one set
 * is safe on one thread, and reusing them avoids allocating a few megabytes per render.
 */
let camBuf: Float64Array = new Float64Array(0) // xr, yr, depth per vertex
let scrBuf: Float64Array = new Float64Array(0) // screen x, y and 1/depth per vertex
let zBuf = new Float32Array(0)
function grow(n: number, buf: Float64Array): Float64Array {
  return buf.length >= n ? buf : new Float64Array(Math.max(n, buf.length * 2))
}

/** Depth of the near plane as a fraction of the camera distance; geometry in front of it is clipped. */
export const NEAR = 1e-3

export function rasterize(
  e: Evaluation,
  c: Camera,
  size: Size,
  o: { hide?: string[]; depth?: boolean; face?: boolean; stats?: Stats } = {},
): LabelRaster {
  if (o.stats) o.stats.rasters++
  const { width: w, height: h } = size
  const f = flatten(e, o.hide ?? [])
  const cls = new Uint8Array(w * h)
  const node = new Uint16Array(w * h)
  // Nearest wins: compare 1/depth, which interpolates linearly in screen space.
  if (zBuf.length < w * h) zBuf = new Float32Array(w * h)
  const zb = zBuf
  zb.fill(0, 0, w * h)
  const face = o.face ? new Int32Array(w * h).fill(-1) : undefined

  const { right, up, back } = cameraBasis(c.azimuth, c.elevation)
  const n = Math.max(w, h)
  const fl = (n * c.distance) / c.span
  const cr = Math.cos((c.roll * Math.PI) / 180)
  const sr = Math.sin((c.roll * Math.PI) / 180)
  const ox = w / 2 + c.shift[0] * n
  const oy = h / 2 + c.shift[1] * n
  const near = Math.max(1e-6, NEAR * c.distance)
  const [tx, ty, tz] = c.target
  const nv = f.pos.length / 3
  camBuf = grow(nv * 3, camBuf)
  scrBuf = grow(nv * 3, scrBuf)
  const C = camBuf
  const P = scrBuf
  for (let i = 0; i < nv; i++) {
    const rx = f.pos[i * 3]! - tx
    const ry = f.pos[i * 3 + 1]! - ty
    const rz = f.pos[i * 3 + 2]! - tz
    const xc = rx * right[0] + ry * right[1] + rz * right[2]
    const yc = rx * up[0] + ry * up[1] + rz * up[2]
    const d = c.distance - (rx * back[0] + ry * back[1] + rz * back[2])
    const xr = xc * cr - yc * sr
    const yr = xc * sr + yc * cr
    C[i * 3] = xr
    C[i * 3 + 1] = yr
    C[i * 3 + 2] = d
    if (d >= near) {
      P[i * 3] = (fl * xr) / d + ox
      P[i * 3 + 1] = (-fl * yr) / d + oy
      P[i * 3 + 2] = 1 / d
    } else P[i * 3 + 2] = -1
  }

  const fill = (
    ax: number,
    ay: number,
    za: number,
    bx: number,
    by: number,
    zbv: number,
    cx: number,
    cy: number,
    zc: number,
    cl: number,
    nd: number,
    t: number,
  ) => {
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (Math.abs(area) < 1e-12) return
    // Pixels whose centres lie inside the triangle.
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5))
    const x1 = Math.min(w - 1, Math.floor(Math.max(ax, bx, cx) - 0.5))
    const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5))
    const y1 = Math.min(h - 1, Math.floor(Math.max(ay, by, cy) - 0.5))
    if (x0 > x1 || y0 > y1) return
    const inv = 1 / area
    // Barycentric weights at the first pixel centre, and their steps per pixel.
    const px0 = x0 + 0.5
    const dw0x = (by - cy) * inv
    const dw1x = (cy - ay) * inv
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5
      let w0 = ((bx - px0) * (cy - py) - (by - py) * (cx - px0)) * inv
      let w1 = ((cx - px0) * (ay - py) - (cy - py) * (ax - px0)) * inv
      const row = y * w
      for (let x = x0; x <= x1; x++, w0 += dw0x, w1 += dw1x) {
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const iz = w0 * za + w1 * zbv + w2 * zc
        const k = row + x
        if (iz > zb[k]!) {
          zb[k] = iz
          cls[k] = cl
          node[k] = nd
          if (face) face[k] = t
        }
      }
    }
  }

  // Clipping a triangle that crosses the near plane: its polygon in front of the plane, as a fan.
  const poly: number[] = []
  const emit = (xr: number, yr: number, d: number) =>
    poly.push((fl * xr) / d + ox, (-fl * yr) / d + oy, 1 / d)
  const clip = (ia: number, ib: number, ic: number, cl: number, nd: number, t: number) => {
    poly.length = 0
    const idx = [ia, ib, ic]
    for (let j = 0; j < 3; j++) {
      const p = idx[j]!
      const q = idx[(j + 1) % 3]!
      const dp = C[p + 2]!
      const dq = C[q + 2]!
      if (dp >= near) emit(C[p]!, C[p + 1]!, dp)
      if (dp >= near !== dq >= near) {
        const s = (near - dp) / (dq - dp)
        emit(C[p]! + s * (C[q]! - C[p]!), C[p + 1]! + s * (C[q + 1]! - C[p + 1]!), near)
      }
    }
    for (let j = 3; j + 3 < poly.length; j += 3)
      fill(
        poly[0]!,
        poly[1]!,
        poly[2]!,
        poly[j]!,
        poly[j + 1]!,
        poly[j + 2]!,
        poly[j + 3]!,
        poly[j + 4]!,
        poly[j + 5]!,
        cl,
        nd,
        t,
      )
  }

  const nt = f.cls.length
  for (let t = 0; t < nt; t++) {
    const ia = f.tri[t * 3]! * 3
    const ib = f.tri[t * 3 + 1]! * 3
    const ic = f.tri[t * 3 + 2]! * 3
    const za = P[ia + 2]!
    const zbv = P[ib + 2]!
    const zc = P[ic + 2]!
    if (za > 0 && zbv > 0 && zc > 0)
      fill(
        P[ia]!,
        P[ia + 1]!,
        za,
        P[ib]!,
        P[ib + 1]!,
        zbv,
        P[ic]!,
        P[ic + 1]!,
        zc,
        f.cls[t]!,
        f.node[t]!,
        t,
      )
    else if (za > 0 || zbv > 0 || zc > 0) clip(ia, ib, ic, f.cls[t]!, f.node[t]!, t)
  }

  const out: LabelRaster = { width: w, height: h, cls, node, nodeIds: f.nodeIds }
  if (o.depth) {
    const depth = new Float32Array(w * h)
    for (let k = 0; k < w * h; k++) depth[k] = zb[k]! > 0 ? 1 / zb[k]! : Infinity
    out.depth = depth
  }
  if (face) out.face = face
  return out
}
