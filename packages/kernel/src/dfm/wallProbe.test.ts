import { describe, expect, it } from 'vitest'
import { exitOf, shownMm, type Vec3, type WallCrossing, type WallRay, wallAt } from './wallProbe'

/** A convex body as half-spaces n·x ≤ d (n outward, unit): its crossings of a ray, exactly. */
const convex =
  (planes: { n: Vec3; d: number }[]): WallRay =>
  (o, dir) => {
    let tIn = Number.NEGATIVE_INFINITY
    let tOut = Number.POSITIVE_INFINITY
    let nIn: Vec3 = [0, 0, 0]
    let nOut: Vec3 = [0, 0, 0]
    for (const { n, d } of planes) {
      const along = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]
      const outside = n[0] * o[0] + n[1] * o[1] + n[2] * o[2] - d
      if (along === 0) {
        if (outside > 0) return []
        continue
      }
      const t = -outside / along
      if (along < 0 && t > tIn) [tIn, nIn] = [t, n]
      if (along > 0 && t < tOut) [tOut, nOut] = [t, n]
    }
    if (tIn > tOut || tOut <= 0) return []
    const out: WallCrossing[] = [{ t: tOut, w: -1, normal: nOut }]
    if (tIn > 0) out.push({ t: tIn, w: 1, normal: nIn })
    return out
  }
const both =
  (...rays: WallRay[]): WallRay =>
  (o, d) =>
    rays.flatMap((r) => r(o, d))
const slab = (z0: number, z1: number) =>
  convex([
    { n: [0, 0, -1], d: -z0 },
    { n: [0, 0, 1], d: z1 },
  ])
/** A wedge on z ≥ 0 whose top face rises from the edge at x = 5 at `degrees` to the base. */
const wedge = (degrees: number) => {
  const a = (degrees * Math.PI) / 180
  return convex([
    { n: [0, 0, -1], d: 0 },
    { n: [Math.sin(a), 0, Math.cos(a)], d: 5 * Math.sin(a) },
  ])
}

describe('wall reading', () => {
  it('reads a plate between its two faces', () => {
    expect(wallAt(slab(0, 0.3), [0, 0, 0.3], [0, 0, 1], 0.5)).toBeCloseTo(0.3, 9)
  })

  it('does not read the rim of a 45° cone as a wall, but does read a feather edge', () => {
    // 0.1 mm from the edge the ray leaves through the other face after 0.1 mm (cone) or 0.018 mm.
    expect(wallAt(wedge(45), [4.9, 0, 0], [0, 0, -1], 0.5)).toBeGreaterThanOrEqual(0.5)
    expect(wallAt(wedge(90), [4.99, 0, 0], [0, 0, -1], 0.5)).toBeGreaterThanOrEqual(0.5)
    // A 22° feather stays under 0.5 mm for 1.2 mm back from its edge: that is a thin wall, and
    // it is reported as the wall a millimetre in, not as the hairline at the edge.
    const feather = wallAt(wedge(22), [4.9, 0, 0], [0, 0, -1], 0.5)
    expect(feather).toBeCloseTo(1.1 * Math.tan((22 * Math.PI) / 180), 9)
    expect(feather).toBeLessThan(0.5)
    // Faces within 20° of opposite are a plate: read as they are.
    expect(wallAt(wedge(10), [4.9, 0, 0], [0, 0, -1], 0.5)).toBeLessThan(0.5)
  })

  it('reads through overlapping shells to where the metal ends', () => {
    // A 2.2 mm wire with an inner shell whose face lies 0.0009 mm from the sample (a bail).
    const wire = both(slab(0, 2.2), slab(-1, 0.0009))
    expect(wallAt(wire, [0, 0, 0], [0, 0, -1], 0.5)).toBeCloseTo(2.2, 9)
    // Passing out of one body and into another is still leaving the metal.
    const gap = both(slab(0, 0.3), slab(1, 3))
    expect(exitOf(gap([0, 0, 0], [0, 0, 1]))?.t).toBeCloseTo(0.3, 9)
  })

  it('compares at the precision people see', () => {
    // A 0.5 mm wire tessellates to 0.4999 mm: not "0.50 mm thin" against a 0.5 mm limit.
    expect(shownMm(0.4999) < 0.5).toBe(false)
    expect(shownMm(0.494) < 0.5).toBe(true)
  })
})
