/** 2D polyline utilities: segment chaining, simplification, hatching. Flat [x, y, …] arrays. */

/** Growable flat float buffer of 2D segments [x0, y0, x1, y1, …]. */
export class SegmentBuffer {
  data = new Float64Array(1024)
  length = 0
  push(x0: number, y0: number, x1: number, y1: number) {
    if (this.length + 4 > this.data.length) {
      const next = new Float64Array(this.data.length * 2)
      next.set(this.data)
      this.data = next
    }
    const d = this.data
    const o = this.length
    d[o] = x0
    d[o + 1] = y0
    d[o + 2] = x1
    d[o + 3] = y1
    this.length += 4
  }
}

/**
 * Joins segments that share endpoints (to 0.1 µm) into polylines, simplifies them with tolerance
 * `tol` and drops polylines shorter than `minLength` — sub-pixel slivers and dash noise.
 */
export function chainSegments(buf: SegmentBuffer, tol: number, minLength: number): Float32Array[] {
  const n = buf.length / 4
  const d = buf.data
  const q = 1e4
  const key = (x: number, y: number) => (Math.round(x * q) + 4e6) * 1e7 + (Math.round(y * q) + 4e6)
  const ends = new Map<number, number[]>()
  for (let s = 0; s < n; s++) {
    for (let e = 0; e < 2; e++) {
      const k = key(d[s * 4 + e * 2]!, d[s * 4 + e * 2 + 1]!)
      const list = ends.get(k)
      if (list) list.push(s * 2 + e)
      else ends.set(k, [s * 2 + e])
    }
  }
  const used = new Uint8Array(n)
  const lines: Float32Array[] = []
  const extend = (pts: number[], s: number, e: number, front: boolean) => {
    let cs = s
    let ce = e
    for (;;) {
      const list = ends.get(key(d[cs * 4 + ce * 2]!, d[cs * 4 + ce * 2 + 1]!))
      const next = list?.find((r) => !used[r >> 1])
      if (next === undefined) return
      cs = next >> 1
      used[cs] = 1
      ce = 1 - (next & 1)
      const nx = d[cs * 4 + ce * 2]!
      const ny = d[cs * 4 + ce * 2 + 1]!
      if (front) pts.unshift(nx, ny)
      else pts.push(nx, ny)
    }
  }
  for (let s = 0; s < n; s++) {
    if (used[s]) continue
    used[s] = 1
    const pts = [d[s * 4]!, d[s * 4 + 1]!, d[s * 4 + 2]!, d[s * 4 + 3]!]
    extend(pts, s, 1, false)
    extend(pts, s, 0, true)
    if (polylineLength(pts) < minLength) continue
    lines.push(simplify(pts, tol))
  }
  return lines
}

export function polylineLength(pts: ArrayLike<number>): number {
  let len = 0
  for (let i = 2; i < pts.length; i += 2)
    len += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!)
  return len
}

/** Douglas–Peucker (iterative), with point-to-segment distances. */
export function simplify(pts: ArrayLike<number>, tol: number): Float32Array {
  const n = pts.length / 2
  if (n <= 2) return Float32Array.from(pts)
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    const ax = pts[i * 2]!
    const ay = pts[i * 2 + 1]!
    const dx = pts[j * 2]! - ax
    const dy = pts[j * 2 + 1]! - ay
    const l2 = dx * dx + dy * dy
    let worst = -1
    let wi = -1
    for (let k = i + 1; k < j; k++) {
      const ex = pts[k * 2]! - ax
      const ey = pts[k * 2 + 1]! - ay
      // Distance to the chord segment, not its line: polylines may double back on themselves.
      const t = l2 > 1e-24 ? Math.max(0, Math.min(1, (ex * dx + ey * dy) / l2)) : 0
      const dist = Math.hypot(ex - dx * t, ey - dy * t)
      if (dist > worst) {
        worst = dist
        wi = k
      }
    }
    if (worst > tol) {
      keep[wi] = 1
      stack.push([i, wi], [wi, j])
    }
  }
  const out: number[] = []
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[k * 2]!, pts[k * 2 + 1]!)
  return Float32Array.from(out)
}

/**
 * Even-odd hatch fill of closed loops: parallel lines at `angleDeg`, `spacing` apart, clipped
 * to the interior. Returns segments [x0, y0, x1, y1, …].
 */
export function hatch(
  loops: readonly ArrayLike<number>[],
  spacing: number,
  angleDeg = 45,
): Float32Array {
  const a = (angleDeg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  // Rotate into a frame where hatch lines are horizontal: v = −x·sin + y·cos.
  const edges: number[] = []
  let vMin = Infinity
  let vMax = -Infinity
  for (const loop of loops) {
    const n = loop.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const u0 = loop[i * 2]! * c + loop[i * 2 + 1]! * s
      const v0 = -loop[i * 2]! * s + loop[i * 2 + 1]! * c
      const u1 = loop[j * 2]! * c + loop[j * 2 + 1]! * s
      const v1 = -loop[j * 2]! * s + loop[j * 2 + 1]! * c
      edges.push(u0, v0, u1, v1)
      vMin = Math.min(vMin, v0)
      vMax = Math.max(vMax, v0)
    }
  }
  const out: number[] = []
  const xs: number[] = []
  for (let v = Math.ceil(vMin / spacing) * spacing; v <= vMax; v += spacing) {
    xs.length = 0
    for (let e = 0; e < edges.length; e += 4) {
      const v0 = edges[e + 1]!
      const v1 = edges[e + 3]!
      if (v0 <= v === v1 <= v) continue
      const t = (v - v0) / (v1 - v0)
      xs.push(edges[e]! + (edges[e + 2]! - edges[e]!) * t)
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const u0 = xs[k]!
      const u1 = xs[k + 1]!
      out.push(u0 * c - v * s, u0 * s + v * c, u1 * c - v * s, u1 * s + v * c)
    }
  }
  return Float32Array.from(out)
}
