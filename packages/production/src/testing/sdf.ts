/** Signed-distance primitives for procedural fixtures (after Quílez). Test fixtures only. */
export type P2 = [number, number]

export const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k)

export function capsule(
  px: number,
  py: number,
  pz: number,
  a: [number, number, number],
  b: [number, number, number],
  r: number,
): number {
  const bax = b[0] - a[0]
  const bay = b[1] - a[1]
  const baz = b[2] - a[2]
  const pax = px - a[0]
  const pay = py - a[1]
  const paz = pz - a[2]
  const t = Math.max(
    0,
    Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)),
  )
  return Math.hypot(pax - bax * t, pay - bay * t, paz - baz * t) - r
}

/** 2D rounded box centred at the origin with half extents (hx, hy). */
export function roundBox2(x: number, y: number, hx: number, hy: number, r: number): number {
  const qx = Math.abs(x) - hx + r
  const qy = Math.abs(y) - hy + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/** Exact signed distance to a closed polygon (negative inside). */
export function polygon(x: number, y: number, v: readonly P2[]): number {
  let d = (x - v[0]![0]) ** 2 + (y - v[0]![1]) ** 2
  let s = 1
  for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) {
    const [vix, viy] = v[i]!
    const [vjx, vjy] = v[j]!
    const ex = vjx - vix
    const ey = vjy - viy
    const wx = x - vix
    const wy = y - viy
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)))
    d = Math.min(d, (wx - ex * t) ** 2 + (wy - ey * t) ** 2)
    const c1 = y >= viy
    const c2 = y < vjy
    const c3 = ex * wy > ey * wx
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s
  }
  return s * Math.sqrt(d)
}

/** Extrudes a 2D distance `d2` symmetrically to half-thickness `h` with edge radius `r`. */
export function extrude(d2: number, w: number, h: number, r: number): number {
  const qx = d2 + r
  const qy = Math.abs(w) - h + r
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r
}

/**
 * A brilliant-cut stone (girdle radius r) as a solid, in its own frame with the table toward
 * +a: crown frustum above the girdle, pavilion cone below. Used to cut seats.
 */
export function stoneSolid(
  a: number,
  rho: number,
  r: number,
  crown: number,
  pavilion: number,
): number {
  const up = a - crown
  const crownSide = (rho - r + (a * (r * 0.43)) / crown) / Math.hypot(1, (r * 0.43) / crown)
  const pav = (rho - r * (1 + a / pavilion)) / Math.hypot(1, r / pavilion)
  return Math.max(up, crownSide, pav, -a - pavilion)
}
