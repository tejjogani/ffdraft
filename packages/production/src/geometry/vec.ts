/** Minimal 3-vector and column-major 4×4 helpers over plain tuples. */
export type V3 = [number, number, number]

export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Applies a column-major 4×4 matrix to a point. */
export function transformPoint(m: readonly number[], x: number, y: number, z: number): V3 {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ]
}
