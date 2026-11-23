/** Minimal 3-vector and column-major 4×4 helpers over plain tuples. */
export type V3 = [number, number, number]

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2])
export const normalize = (a: V3): V3 => {
  const l = length(a)
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0]
}

/** Applies a column-major 4×4 matrix to a point. */
export function transformPoint(m: readonly number[], x: number, y: number, z: number): V3 {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ]
}

/** Applies only the linear part of a column-major matrix (directions, extents). */
export function transformDir(m: readonly number[], x: number, y: number, z: number): V3 {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z,
    m[1]! * x + m[5]! * y + m[9]! * z,
    m[2]! * x + m[6]! * y + m[10]! * z,
  ]
}
