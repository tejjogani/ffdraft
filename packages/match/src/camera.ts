/**
 * The camera model. The basis is duplicated from `@pave/render`'s `cameraBasis` (this package may
 * not import the render layer) and locked to it by a fixture test, so a camera fitted here frames
 * the same picture there.
 */
import type { Evaluation } from '@pave/kernel/types'
import type { Camera, Size, Vec3 } from './types'

const DEG = Math.PI / 180

/** Azimuth and elevation of the canon's views (`VIEWS` in @pave/canon, less `onBody`). */
export const VIEW_SEEDS = {
  top: [0, 90],
  front: [0, 10],
  side: [90, 4],
  threeQuarter: [45, 42],
  back: [180, 10],
  under: [0, -90],
} as const satisfies Record<string, readonly [number, number]>
export type ViewSeed = keyof typeof VIEW_SEEDS

/** Right, up and back (toward the camera) unit vectors of an orbit camera. */
export function cameraBasis(
  azimuth: number,
  elevation: number,
): { right: Vec3; up: Vec3; back: Vec3 } {
  const a = azimuth * DEG
  const e = elevation * DEG
  const back: Vec3 = [Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e)]
  // The pivot's X axis stays horizontal at every elevation, so top views stay upright.
  const right: Vec3 = [Math.cos(a), Math.sin(a), 0]
  const up: Vec3 = [
    back[1] * right[2] - back[2] * right[1],
    back[2] * right[0] - back[0] * right[2],
    back[0] * right[1] - back[1] * right[0],
  ]
  return { right, up, back }
}

/**
 * Pixel position and camera depth (mm) of a world point. `N` is the larger image side; the
 * principal point is the image centre plus `shift · N`.
 */
export function project(c: Camera, size: Size, p: Vec3): { x: number; y: number; depth: number } {
  const { right, up, back } = cameraBasis(c.azimuth, c.elevation)
  const n = Math.max(size.width, size.height)
  const f = (n * c.distance) / c.span
  const rx = p[0] - c.target[0]
  const ry = p[1] - c.target[1]
  const rz = p[2] - c.target[2]
  const xc = rx * right[0] + ry * right[1] + rz * right[2]
  const yc = rx * up[0] + ry * up[1] + rz * up[2]
  const depth = c.distance - (rx * back[0] + ry * back[1] + rz * back[2])
  const cr = Math.cos(c.roll * DEG)
  const sr = Math.sin(c.roll * DEG)
  const xr = xc * cr - yc * sr
  const yr = xc * sr + yc * cr
  return {
    x: (f * xr) / depth + size.width / 2 + c.shift[0] * n,
    y: (-f * yr) / depth + size.height / 2 + c.shift[1] * n,
    depth,
  }
}

/** The world point at pixel (x, y) and camera depth `depth`; the inverse of {@link project}. */
export function unproject(c: Camera, size: Size, x: number, y: number, depth: number): Vec3 {
  const { right, up, back } = cameraBasis(c.azimuth, c.elevation)
  const n = Math.max(size.width, size.height)
  const f = (n * c.distance) / c.span
  const xr = ((x - size.width / 2 - c.shift[0] * n) * depth) / f
  const yr = (-(y - size.height / 2 - c.shift[1] * n) * depth) / f
  const cr = Math.cos(c.roll * DEG)
  const sr = Math.sin(c.roll * DEG)
  const xc = xr * cr + yr * sr
  const yc = -xr * sr + yr * cr
  const b = c.distance - depth
  return [
    c.target[0] + xc * right[0] + yc * up[0] + b * back[0],
    c.target[1] + xc * right[1] + yc * up[1] + b * back[1],
    c.target[2] + xc * right[2] + yc * up[2] + b * back[2],
  ]
}

/** Bounds of the drawn geometry, leaving hidden nodes out (a chain would dwarf its pendant). */
export function visibleBounds(
  e: Evaluation,
  hide: readonly string[] = [],
): { min: Vec3; max: Vec3 } {
  if (!hide.length) return { min: [...e.report.bounds.min], max: [...e.report.bounds.max] }
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  const grow = (x: number, y: number, z: number) => {
    if (x < min[0]) min[0] = x
    if (y < min[1]) min[1] = y
    if (z < min[2]) min[2] = z
    if (x > max[0]) max[0] = x
    if (y > max[1]) max[1] = y
    if (z > max[2]) max[2] = z
  }
  for (const p of e.parts) {
    if (hide.includes(p.nodeId)) continue
    grow(...p.bounds.min)
    grow(...p.bounds.max)
  }
  for (const s of e.stones) {
    if (hide.includes(s.nodeId)) continue
    const m = s.matrix
    const r = Math.max(s.dims.width, s.dims.length) / 2
    grow(m[12]! - r, m[13]! - r, m[14]! - r)
    grow(m[12]! + r, m[13]! + r, m[14]! + r)
  }
  if (min[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0] }
  return { min, max }
}

export function boundsDiagonal(b: { min: Vec3; max: Vec3 }): number {
  return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
}

/**
 * A camera from a canon view: aimed at the centre of the visible bounds, `distanceRatio`
 * (default 10) bounding diagonals away, with the diagonal filling about two thirds of the frame.
 */
export function defaultCamera(
  e: Evaluation,
  seed: ViewSeed,
  o: { distanceRatio?: number; hide?: string[] } = {},
): Camera {
  const b = visibleBounds(e, o.hide)
  const diag = Math.max(boundsDiagonal(b), 1e-3)
  const [azimuth, elevation] = VIEW_SEEDS[seed]
  return {
    azimuth,
    elevation,
    roll: 0,
    distance: diag * (o.distanceRatio ?? 10),
    span: diag / 0.66,
    shift: [0, 0],
    target: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
  }
}
