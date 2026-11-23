/**
 * Hidden-line removal for drafting views.
 *
 * Candidate lines are what a draughtsman would draw: feature (crease) edges, open boundaries,
 * smooth contours traced through triangles where the shading normal turns away from the viewer
 * (so curved bands get one clean outline instead of a zig-zag along mesh edges), and, for
 * faceted stones, only the face silhouette — a stone reads as its outline, not its facets.
 *
 * Visibility is decided against a depth buffer of every body (metal and stones occlude alike):
 * each candidate is sampled at sub-pixel spacing and split into visible and hidden runs. This is
 * linear in triangles and candidate length, so a million-triangle part costs about a second per
 * view, where exact analytic HLR would be quadratic in the worst case.
 */
import type { EdgeTable } from '../geometry/mesh'
import { chainSegments, SegmentBuffer } from './polyline'
import type { ViewDef } from './views'

export interface SceneBody {
  kind: 'metal' | 'stone'
  positions: Float32Array
  indices: Uint32Array
  /** Shading normals per vertex; contours are traced from these (metal). */
  normals?: Float32Array
  /** Face normals (stones), for face-silhouette extraction over `edges`. */
  faceNormals?: Float32Array
  /** Edge adjacency over welded vertices: boundaries (metal) and silhouettes (stones). */
  edges?: EdgeTable
  /** World-space segments always offered as candidates: creases, stone tables. */
  features?: Float32Array
}

export interface Box2 {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ViewLines {
  /** Polylines as flat [x0, y0, x1, y1, …] in view millimetres (y up). */
  metal: Float32Array[]
  stones: Float32Array[]
  hidden: Float32Array[]
  bounds: Box2
}

export interface HlrOptions {
  /** Depth-buffer pixels along the longer side of the view. */
  resolution?: number
  /** Keep hidden metal lines (drawn dashed). */
  hidden?: boolean
  /** Douglas–Peucker tolerance in view millimetres. */
  tolerance?: number
  /** Extra visible-candidate segments in world space (e.g. section cut outlines). */
  extra?: Float32Array
}

const METAL = 0
const STONE = 1
const HIDDEN = 2
/** Sample state: visible but lying on a nearer drawn line. */
const DUPLICATE = 2

/** Growable buffer of 3D candidate segments in view space. */
class Buf {
  data = new Float64Array(1024)
  length = 0
  push6(a: number, b: number, c: number, d: number, e: number, f: number) {
    if (this.length + 6 > this.data.length) {
      const next = new Float64Array(this.data.length * 2)
      next.set(this.data)
      this.data = next
    }
    const o = this.length
    this.data[o] = a
    this.data[o + 1] = b
    this.data[o + 2] = c
    this.data[o + 3] = d
    this.data[o + 4] = e
    this.data[o + 5] = f
    this.length += 6
  }
}

function projectAll(p: Float32Array, v: ViewDef): Float32Array {
  const n = p.length / 3
  const out = new Float32Array(p.length)
  const [rx, ry, rz] = v.right
  const [ux, uy, uz] = v.up
  const [tx, ty, tz] = v.toward
  for (let i = 0; i < n; i++) {
    const x = p[i * 3]!
    const y = p[i * 3 + 1]!
    const z = p[i * 3 + 2]!
    out[i * 3] = x * rx + y * ry + z * rz
    out[i * 3 + 1] = x * ux + y * uy + z * uz
    out[i * 3 + 2] = x * tx + y * ty + z * tz
  }
  return out
}

export function hiddenLines(
  bodies: readonly SceneBody[],
  view: ViewDef,
  opts: HlrOptions = {},
): ViewLines {
  const clip = view.clipDepth ?? Number.POSITIVE_INFINITY
  const res = opts.resolution ?? 2048
  const projected = bodies.map((b) => projectAll(b.positions, view))

  // Bounds of what remains after the clip plane.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const pp of projected) {
    for (let i = 0; i < pp.length; i += 3) {
      if (pp[i + 2]! > clip) continue
      const x = pp[i]!
      const y = pp[i + 1]!
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minX))
    return { metal: [], stones: [], hidden: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }

  const px = Math.max(maxX - minX, maxY - minY, 1e-3) / res
  // A three-pixel apron keeps every neighbourhood lookup inside the buffer.
  const ox = minX - 3 * px
  const oy = minY - 3 * px
  const W = Math.ceil((maxX - minX) / px) + 7
  const H = Math.ceil((maxY - minY) / px) + 7
  const depth = new Float32Array(W * H).fill(Number.NEGATIVE_INFINITY)
  const back = Number.isFinite(clip) ? new Uint8Array(W * H) : null

  bodies.forEach((b, bi) => {
    rasterize(projected[bi]!, b.indices, depth, back, W, H, ox, oy, px, clip)
  })
  if (back) {
    // Capping: where the nearest surface faces away we are looking into solid material, i.e. at
    // the cut face, which occludes everything behind it.
    for (let i = 0; i < depth.length; i++) if (back[i]) depth[i] = clip
  }

  const cand = new Buf()
  const cls: number[] = []
  /** Per candidate: neighbourhood radius in pixels for the visibility test. */
  const reach: number[] = []
  const add = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    c: number,
    r = 1,
  ) => {
    cand.push6(x0, y0, z0, x1, y1, z1)
    cls.push(c)
    reach.push(r)
  }

  bodies.forEach((b, bi) => {
    const pp = projected[bi]!
    const c = b.kind === 'stone' ? STONE : METAL
    if (b.features) addWorldSegments(b.features, view, c, add)
    if (b.normals && b.kind === 'metal') traceContours(pp, b.indices, b.normals, view, add)
    if (b.edges) {
      const e = b.edges
      const fn = b.faceNormals
      const [tx, ty, tz] = view.toward
      for (let k = 0; k < e.count; k++) {
        const f0 = e.f0[k]!
        const f1 = e.f1[k]!
        let draw = f1 < 0
        if (!draw && fn) {
          const s0 = fn[f0 * 3]! * tx + fn[f0 * 3 + 1]! * ty + fn[f0 * 3 + 2]! * tz > 0
          const s1 = fn[f1 * 3]! * tx + fn[f1 * 3 + 1]! * ty + fn[f1 * 3 + 2]! * tz > 0
          draw = s0 !== s1
        }
        if (!draw) continue
        const i = e.a[k]! * 3
        const j = e.b[k]! * 3
        add(pp[i]!, pp[i + 1]!, pp[i + 2]!, pp[j]!, pp[j + 1]!, pp[j + 2]!, c)
      }
    }
  })
  if (opts.extra) addWorldSegments(opts.extra, view, METAL, add)

  const out = [new SegmentBuffer(), new SegmentBuffer(), new SegmentBuffer()] as const
  const eps = 2.5 * px
  const visibleAt = (x: number, y: number, z: number, r: number): boolean => {
    const i = Math.floor((x - ox) / px)
    const j = Math.floor((y - oy) / px)
    let m = Number.POSITIVE_INFINITY
    for (let dj = -r; dj <= r; dj++) {
      const row = (j + dj) * W
      for (let di = -r; di <= r; di++) {
        const d = depth[row + i + di]
        if (d !== undefined && d < m) m = d
      }
    }
    return z + eps >= m
  }

  // Two passes over the candidates. The first stamps the depth of every visible sample into a
  // line buffer; the second drops visible samples lying on a nearer line — a back edge that
  // projects exactly onto a front edge is the same drawn line, not a second one.
  const lineDepth = new Float32Array(W * H).fill(Number.NEGATIVE_INFINITY)
  const dupEps = 10 * px
  const nearerLine = (x: number, y: number, z: number): boolean => {
    const i = Math.floor((x - ox) / px)
    const j = Math.floor((y - oy) / px)
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++)
        if (lineDepth[(j + dj) * W + i + di]! > z + dupEps) return true
    return false
  }
  let states = new Uint8Array(256)
  const d = cand.data
  for (const pass of [0, 1] as const) {
    for (let s = 0; s < cls.length; s++) {
      let x0 = d[s * 6]!
      let y0 = d[s * 6 + 1]!
      let z0 = d[s * 6 + 2]!
      let x1 = d[s * 6 + 3]!
      let y1 = d[s * 6 + 4]!
      let z1 = d[s * 6 + 5]!
      if (z0 > clip && z1 > clip) continue
      if (z0 > clip || z1 > clip) {
        const t = (clip - z0) / (z1 - z0)
        const cx = x0 + (x1 - x0) * t
        const cy = y0 + (y1 - y0) * t
        if (z0 > clip) {
          x0 = cx
          y0 = cy
          z0 = clip
        } else {
          x1 = cx
          y1 = cy
          z1 = clip
        }
      }
      const len = Math.hypot(x1 - x0, y1 - y0) / px
      if (len < 0.05) continue
      const n = Math.max(1, Math.ceil(len / 0.7))
      if (states.length < n + 1) states = new Uint8Array((n + 1) * 2)
      const r = reach[s]!
      for (let k = 0; k <= n; k++) {
        const t = k / n
        const x = x0 + (x1 - x0) * t
        const y = y0 + (y1 - y0) * t
        const z = z0 + (z1 - z0) * t
        const visible = visibleAt(x, y, z, r)
        if (pass === 0) {
          if (visible) {
            const o = Math.floor((y - oy) / px) * W + Math.floor((x - ox) / px)
            if (z > lineDepth[o]!) lineDepth[o] = z
          }
          continue
        }
        states[k] = visible ? (nearerLine(x, y, z) ? DUPLICATE : 1) : 0
      }
      if (pass === 0) continue
      // A lone sample disagreeing with both neighbours is depth-buffer noise, not an occluder.
      for (let k = 1; k < n; k++)
        if (states[k - 1] === states[k + 1] && states[k] !== states[k - 1])
          states[k] = states[k - 1]!
      const visCls = cls[s]!
      let start = 0
      for (let k = 1; k <= n + 1; k++) {
        if (k <= n && states[k] === states[start]) continue
        const ta = start === 0 ? 0 : (start - 0.5) / n
        const tb = k > n ? 1 : (k - 0.5) / n
        const state = states[start]
        const target = state === 1 ? visCls : state === 0 && visCls === METAL ? HIDDEN : -1
        if (target >= 0 && (target !== HIDDEN || opts.hidden)) {
          out[target]!.push(
            x0 + (x1 - x0) * ta,
            y0 + (y1 - y0) * ta,
            x0 + (x1 - x0) * tb,
            y0 + (y1 - y0) * tb,
          )
        }
        start = k
      }
    }
  }

  const tol = opts.tolerance ?? 0.01
  return {
    metal: chainSegments(out[METAL], tol, 0.02),
    stones: chainSegments(out[STONE], tol, 0.02),
    hidden: chainSegments(out[HIDDEN], tol, 0.25),
    bounds: { minX, minY, maxX, maxY },
  }
}

function addWorldSegments(
  segs: Float32Array,
  view: ViewDef,
  c: number,
  add: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => void,
) {
  const pp = projectAll(segs, view)
  for (let i = 0; i + 5 < pp.length; i += 6)
    add(pp[i]!, pp[i + 1]!, pp[i + 2]!, pp[i + 3]!, pp[i + 4]!, pp[i + 5]!, c)
}

/** Zero crossings of n·toward over each triangle, interpolated canonically (low → high index). */
function traceContours(
  pp: Float32Array,
  idx: Uint32Array,
  normals: Float32Array,
  view: ViewDef,
  add: (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    c: number,
    r?: number,
  ) => void,
) {
  const [tx, ty, tz] = view.toward
  // Offset the zero level: a flat face seen exactly edge-on has n·v ≈ 0 everywhere, and noise
  // would scatter contour fragments over it. With the offset it reads as back-facing and the
  // contour lands cleanly where its fillet turns toward the viewer.
  const tau = 2e-3
  const g = (v: number) =>
    normals[v * 3]! * tx + normals[v * 3 + 1]! * ty + normals[v * 3 + 2]! * tz - tau
  const pts: number[] = []
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f]!
    const b = idx[f + 1]!
    const c = idx[f + 2]!
    const ga = g(a)
    const gb = g(b)
    const gc = g(c)
    if (ga > 0 === gb > 0 && gb > 0 === gc > 0) continue
    pts.length = 0
    for (const [i, j, gi, gj] of [
      [a, b, ga, gb],
      [b, c, gb, gc],
      [c, a, gc, ga],
    ] as const) {
      if (gi > 0 === gj > 0) continue
      const [lo, hi, glo, ghi] = i < j ? [i, j, gi, gj] : [j, i, gj, gi]
      const t = glo / (glo - ghi)
      pts.push(
        pp[lo * 3]! + (pp[hi * 3]! - pp[lo * 3]!) * t,
        pp[lo * 3 + 1]! + (pp[hi * 3 + 1]! - pp[lo * 3 + 1]!) * t,
        pp[lo * 3 + 2]! + (pp[hi * 3 + 2]! - pp[lo * 3 + 2]!) * t,
      )
    }
    // Interpolated contours sit up to a couple of pixels inside the true silhouette, where the
    // surface itself would occlude them; widen their neighbourhood to see past it.
    if (pts.length === 6) add(pts[0]!, pts[1]!, pts[2]!, pts[3]!, pts[4]!, pts[5]!, METAL, 2)
  }
}

function rasterize(
  pp: Float32Array,
  idx: Uint32Array,
  depth: Float32Array,
  back: Uint8Array | null,
  W: number,
  H: number,
  ox: number,
  oy: number,
  px: number,
  clip: number,
) {
  const inv = 1 / px
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f]! * 3
    const b = idx[f + 1]! * 3
    const c = idx[f + 2]! * 3
    const za = pp[a + 2]!
    const zb = pp[b + 2]!
    const zc = pp[c + 2]!
    if (za > clip && zb > clip && zc > clip) continue
    const ua = (pp[a]! - ox) * inv
    const va = (pp[a + 1]! - oy) * inv
    const ub = (pp[b]! - ox) * inv
    const vb = (pp[b + 1]! - oy) * inv
    const uc = (pp[c]! - ox) * inv
    const vc = (pp[c + 1]! - oy) * inv
    const area = (ub - ua) * (vc - va) - (uc - ua) * (vb - va)
    if (Math.abs(area) < 1e-12) continue
    const facesAway = area < 0 ? 1 : 0
    const i0 = Math.max(0, Math.ceil(Math.min(ua, ub, uc) - 0.5))
    const i1 = Math.min(W - 1, Math.floor(Math.max(ua, ub, uc) - 0.5))
    const j0 = Math.max(0, Math.ceil(Math.min(va, vb, vc) - 0.5))
    const j1 = Math.min(H - 1, Math.floor(Math.max(va, vb, vc) - 0.5))
    if (i0 > i1 || j0 > j1) continue
    const ia = 1 / area
    for (let j = j0; j <= j1; j++) {
      const cy = j + 0.5
      for (let i = i0; i <= i1; i++) {
        const cx = i + 0.5
        const w0 = ((ub - cx) * (vc - cy) - (uc - cx) * (vb - cy)) * ia
        if (w0 < 0) continue
        const w1 = ((uc - cx) * (va - cy) - (ua - cx) * (vc - cy)) * ia
        if (w1 < 0) continue
        const w2 = 1 - w0 - w1
        if (w2 < 0) continue
        const z = w0 * za + w1 * zb + w2 * zc
        if (z > clip) continue
        const o = j * W + i
        if (z > depth[o]!) {
          depth[o] = z
          if (back) back[o] = facesAway
        }
      }
    }
  }
}
