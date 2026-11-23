/** Small vector helpers for the resolver. Vectors are plain tuples so jobs serialise as JSON. */

export type Vec3 = [number, number, number]
/** Unit quaternion, [x, y, z, w]. */
export type Quat = [number, number, number, number]

export const DEG = Math.PI / 180

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1))

/**
 * Direction for an orbit around a target in the Z-up piece frame. Azimuth 0 looks at the piece
 * from −Y (its front, per the design space convention), positive azimuth swings toward +X;
 * elevation is above the XY plane.
 */
export function orbitDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const a = azimuthDeg * DEG
  const e = elevationDeg * DEG
  return [Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e)]
}

/** Quaternion of the rotation whose columns are the given orthonormal basis. */
export function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const [m00, m10, m20] = x
  const [m01, m11, m21] = y
  const [m02, m12, m22] = z
  const trace = m00 + m11 + m22
  let q: Quat
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
  }
  return q
}

/**
 * Orientation that points an object's local −Z at `target` with local +Y as close to `up` as
 * possible — the convention shared by cameras, Blender area lights and three.js lights.
 */
export function lookAtQuat(from: Vec3, target: Vec3, up: Vec3 = [0, 0, 1]): Quat {
  const back = normalize(sub(from, target))
  let right = cross(up, back)
  if (length(right) < 1e-6) right = cross([0, 1, 0], back)
  right = normalize(right)
  return quatFromBasis(right, cross(back, right), back)
}

/** Rotates a vector by a quaternion. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q
  const u: Vec3 = [x, y, z]
  const t = scale(cross(u, v), 2)
  return add(add(v, scale(t, w)), cross(u, t))
}

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
