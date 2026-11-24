/**
 * Where the links go: a straight run along X, or a necklace hanging in the XZ plane.
 *
 * The drape is the shape a chain takes over a neck under its own weight, seen from the front: a
 * belt around two circles — the neck above, a small bend below where it gathers (tight when a
 * pendant pulls it into a V, loose otherwise). A chain too short to pass over a neck is a
 * circle: a bracelet or choker. Arc length is measured from the low point, so link 0 is the one
 * a bail hangs from.
 */
import type { Mat4, Vec3 } from '../../geometry/vec'

export interface ChainPath {
  /** Point at arc length s (wrapped for closed paths). */
  at(s: number): { point: Vec3 }
  length: number
  closed: boolean
  /** Out of the chain's face: the way the stones and diamond-cut faces look. */
  face: Vec3
  /** Tightest radius the path turns through (Infinity when straight). */
  minRadius: number
}

/** Half the neck width a necklace drapes over, mm (an average adult neck is ~110–120 mm wide). */
const NECK_RADIUS = 58

export function straightPath(length: number): ChainPath {
  return {
    length,
    closed: false,
    face: [0, 0, 1],
    minRadius: Infinity,
    at: (s) => ({ point: [s - length / 2, 0, 0] }),
  }
}

/** Belt length around circles R (top) and r (bottom) whose centres are D apart. */
const beltLength = (R: number, r: number, D: number): number => {
  const phi = Math.asin((R - r) / D)
  return r * (Math.PI - 2 * phi) + R * (Math.PI + 2 * phi) + 2 * Math.sqrt(D * D - (R - r) ** 2)
}

/** Closed drape of `length` in the XZ plane, low point at the origin, facing −Y. */
export function drapePath(length: number, bend: number): ChainPath {
  const face: Vec3 = [0, -1, 0]
  const R = Math.min(NECK_RADIUS, length / (2 * Math.PI))
  const r = Math.min(bend, R)
  if (length <= 2 * Math.PI * R + 1e-9 || r >= R) {
    const radius = length / (2 * Math.PI)
    return {
      length,
      closed: true,
      face,
      minRadius: radius,
      at(s) {
        const a = s / radius - Math.PI / 2
        return { point: [radius * Math.cos(a), 0, radius * Math.sin(a) + radius] }
      },
    }
  }
  // Centre distance D: the belt length grows monotonically with it.
  let lo = R - r + 1e-6
  let hi = length
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (beltLength(R, r, mid) < length) lo = mid
    else hi = mid
  }
  const D = (lo + hi) / 2
  const phi = Math.asin((R - r) / D)
  const line = Math.sqrt(D * D - (R - r) ** 2)
  const tip = r * (Math.PI / 2 - phi)
  const neck = R * (Math.PI + 2 * phi)
  // In (x, z) with the tip circle centred at (0, r) so the low point is the origin.
  const tipCentre = r
  const neckCentre = r + D
  const onCircle = (cz: number, radius: number, a: number) => ({
    point: [radius * Math.cos(a), 0, cz + radius * Math.sin(a)] as Vec3,
  })
  const segment = (a: Vec3, b: Vec3, f: number) => ({
    point: [a[0] + (b[0] - a[0]) * f, 0, a[2] + (b[2] - a[2]) * f] as Vec3,
  })
  const rightLow = onCircle(tipCentre, r, -phi).point
  const rightHigh = onCircle(neckCentre, R, -phi).point
  const leftHigh = onCircle(neckCentre, R, Math.PI + phi).point
  const leftLow = onCircle(tipCentre, r, Math.PI + phi).point
  const total = 2 * tip + 2 * line + neck
  return {
    length: total,
    closed: true,
    face,
    minRadius: r,
    at(input) {
      const s = ((input % total) + total) % total
      if (s < tip) return onCircle(tipCentre, r, -Math.PI / 2 + s / r)
      if (s < tip + line) return segment(rightLow, rightHigh, (s - tip) / line)
      if (s < tip + line + neck) return onCircle(neckCentre, R, -phi + (s - tip - line) / R)
      if (s < tip + 2 * line + neck)
        return segment(leftHigh, leftLow, (s - tip - line - neck) / line)
      return onCircle(tipCentre, r, Math.PI + phi + (s - tip - 2 * line - neck) / r)
    },
  }
}

/**
 * Frames for links whose centres sit at the given arc lengths: x along the chord through the
 * link (so neighbours meet as they would on the curve), z toward `path.face`.
 */
export function linkFrames(path: ChainPath, centres: readonly number[], halfSpan: number): Mat4[] {
  return centres.map((s) => {
    const p = path.at(s).point
    const a = path.at(s - halfSpan).point
    const b = path.at(s + halfSpan).point
    let x: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const xl = Math.hypot(...x) || 1
    x = [x[0] / xl, x[1] / xl, x[2] / xl]
    const f = path.face
    const fx = f[0] - x[0] * (f[0] * x[0] + f[1] * x[1] + f[2] * x[2])
    const fy = f[1] - x[1] * (f[0] * x[0] + f[1] * x[1] + f[2] * x[2])
    const fz = f[2] - x[2] * (f[0] * x[0] + f[1] * x[1] + f[2] * x[2])
    const zl = Math.hypot(fx, fy, fz) || 1
    const z: Vec3 = [fx / zl, fy / zl, fz / zl]
    const y: Vec3 = [
      z[1] * x[2] - z[2] * x[1],
      z[2] * x[0] - z[0] * x[2],
      z[0] * x[1] - z[1] * x[0],
    ]
    return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, p[0], p[1], p[2], 1]
  })
}
