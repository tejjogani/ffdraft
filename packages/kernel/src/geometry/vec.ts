/**
 * Small vector / matrix / frame toolkit. Plain tuples and arrays so values cross the Worker
 * boundary and hash trivially; matrices are column-major 4×4 like glTF and three.js.
 */

export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]
/** Column-major 4×4. */
export type Mat4 = readonly number[]

/** A right-handed orthonormal frame. */
export interface Frame {
  origin: Vec3
  x: Vec3
  y: Vec3
  z: Vec3
}

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
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b))
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
/** a + b·s — the workhorse of frame arithmetic. */
export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
]

export function normalize(a: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 {
  const l = length(a)
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : fallback
}

/** Any unit vector perpendicular to `n`. */
export function perpendicular(n: Vec3): Vec3 {
  const other: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  return normalize(cross(n, other))
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
/** C¹ ease between 0 and 1. */
export const smoothstep = (t: number): number => {
  const c = clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}
/** C² ease between 0 and 1 (zero first and second derivative at both ends). */
export const smootherstep = (t: number): number => {
  const c = clamp(t, 0, 1)
  return c * c * c * (c * (c * 6 - 15) + 10)
}

// ── Frames ───────────────────────────────────────────────────────────────────────────────────

export const WORLD: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }

/** Frame at `origin` whose z is `z`; x is `xHint` made perpendicular to z (or any perpendicular). */
export function frameFromZ(origin: Vec3, z: Vec3, xHint?: Vec3): Frame {
  const zn = normalize(z)
  let x = xHint ? sub(xHint, scale(zn, dot(xHint, zn))) : perpendicular(zn)
  if (length(x) < 1e-9) x = perpendicular(zn)
  x = normalize(x)
  return { origin, x, y: cross(zn, x), z: zn }
}

/** World position of a point given in frame coordinates. */
export const fromFrame = (f: Frame, p: Vec3): Vec3 => [
  f.origin[0] + f.x[0] * p[0] + f.y[0] * p[1] + f.z[0] * p[2],
  f.origin[1] + f.x[1] * p[0] + f.y[1] * p[1] + f.z[1] * p[2],
  f.origin[2] + f.x[2] * p[0] + f.y[2] * p[1] + f.z[2] * p[2],
]

/** Frame coordinates of a world point. */
export function toFrame(f: Frame, p: Vec3): Vec3 {
  const d = sub(p, f.origin)
  return [dot(d, f.x), dot(d, f.y), dot(d, f.z)]
}

/** Rotates the frame about its own z by `angle` radians. */
export function spinFrame(f: Frame, angle: number): Frame {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return {
    origin: f.origin,
    x: add(scale(f.x, c), scale(f.y, s)),
    y: add(scale(f.x, -s), scale(f.y, c)),
    z: f.z,
  }
}

// ── Matrices ─────────────────────────────────────────────────────────────────────────────────

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

export const isIdentity = (m: Mat4): boolean =>
  m === IDENTITY || m.every((v, i) => v === IDENTITY[i])

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!
      out[c * 4 + r] = s
    }
  return out
}

export const transformPoint = (m: Mat4, p: Vec3): Vec3 => [
  m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
  m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
  m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
]

export const transformDirection = (m: Mat4, d: Vec3): Vec3 => [
  m[0]! * d[0] + m[4]! * d[1] + m[8]! * d[2],
  m[1]! * d[0] + m[5]! * d[1] + m[9]! * d[2],
  m[2]! * d[0] + m[6]! * d[1] + m[10]! * d[2],
]

export const translation = (t: Vec3): Mat4 => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  t[0],
  t[1],
  t[2],
  1,
]

/** Matrix taking frame coordinates to world, with a per-axis scale applied first. */
export function frameMatrix(f: Frame, s: Vec3 = [1, 1, 1]): Mat4 {
  return [
    f.x[0] * s[0], f.x[1] * s[0], f.x[2] * s[0], 0,
    f.y[0] * s[1], f.y[1] * s[1], f.y[2] * s[1], 0,
    f.z[0] * s[2], f.z[1] * s[2], f.z[2] * s[2], 0,
    f.origin[0], f.origin[1], f.origin[2], 1,
  ] // biome-ignore format: matrix layout
}

/**
 * Position · rotation · uniform scale, the schema's node `transform`. Rotation is Euler XYZ in
 * degrees with R = Rx·Ry·Rz — three.js' default order, so the viewport's gizmo and the kernel
 * agree on what `rotation: [90, 0, 0]` means.
 */
export function composeTransform(position: Vec3, rotationDeg: Vec3, s: number): Mat4 {
  const [a, c, e] = rotationDeg.map((d) => Math.cos(d * DEG)) as [number, number, number]
  const [b, d, f] = rotationDeg.map((v) => Math.sin(v * DEG)) as [number, number, number]
  return [
    c * e * s, (a * f + b * d * e) * s, (b * f - a * d * e) * s, 0,
    -c * f * s, (a * e - b * d * f) * s, (b * e + a * d * f) * s, 0,
    d * s, -b * c * s, a * c * s, 0,
    position[0], position[1], position[2], 1,
  ] // biome-ignore format: matrix layout
}

/** The uniform scale factor of a similarity matrix. */
export const uniformScaleOf = (m: Mat4): number => Math.hypot(m[0]!, m[1]!, m[2]!)

/** Moves a frame by a similarity transform (axes stay orthonormal). */
export function transformFrame(m: Mat4, f: Frame): Frame {
  return {
    origin: transformPoint(m, f.origin),
    x: normalize(transformDirection(m, f.x)),
    y: normalize(transformDirection(m, f.y)),
    z: normalize(transformDirection(m, f.z)),
  }
}

/** Inverse of a similarity matrix (rotation · uniform scale + translation). */
export function invertSimilarity(m: Mat4): Mat4 {
  const s2 = m[0]! * m[0]! + m[1]! * m[1]! + m[2]! * m[2]!
  const r = [
    m[0]! / s2, m[4]! / s2, m[8]! / s2,
    m[1]! / s2, m[5]! / s2, m[9]! / s2,
    m[2]! / s2, m[6]! / s2, m[10]! / s2,
  ] // biome-ignore format: matrix layout
  const t: Vec3 = [m[12]!, m[13]!, m[14]!]
  return [
    r[0]!, r[1]!, r[2]!, 0,
    r[3]!, r[4]!, r[5]!, 0,
    r[6]!, r[7]!, r[8]!, 0,
    -(r[0]! * t[0] + r[3]! * t[1] + r[6]! * t[2]),
    -(r[1]! * t[0] + r[4]! * t[1] + r[7]! * t[2]),
    -(r[2]! * t[0] + r[5]! * t[1] + r[8]! * t[2]),
    1,
  ] // biome-ignore format: matrix layout
}
