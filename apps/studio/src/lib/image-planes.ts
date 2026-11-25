/**
 * Image planes, the arithmetic: where a reference picture lies in a CAD view, how dragging moves
 * it and how two clicked points and a typed distance scale it. Pure, so the viewer, the overlay
 * and the tests share one definition.
 *
 * Each view has its own 2D axes in the piece's mm (Z up, the front faces -Y):
 *   front: right = +X, up = +Z, the picture faces the front camera (-Y);
 *   top:   right = +X, up = +Y, the picture faces up (+Z);
 *   right: right = +Y, up = +Z, the picture faces the right camera (+X).
 * The picture lies through the centre of the piece's bounds along the view's depth, so its
 * scale matches the piece where the piece is (the viewport is a perspective view).
 */
import type { ImagePlane, ImagePlaneView } from '@pave/schema'

export type Vec3 = [number, number, number]
export type Vec2 = [number, number]

export interface ViewAxes {
  right: Vec3
  up: Vec3
  /** Toward the camera that looks at this view. */
  normal: Vec3
  /** Which coordinate is the depth (0 = x, 1 = y, 2 = z). */
  depth: 0 | 1 | 2
}

export const VIEW_AXES: Record<ImagePlaneView, ViewAxes> = {
  front: { right: [1, 0, 0], up: [0, 0, 1], normal: [0, -1, 0], depth: 1 },
  top: { right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1], depth: 2 },
  right: { right: [0, 1, 0], up: [0, 0, 1], normal: [1, 0, 0], depth: 0 },
}

/** The exact orbit angles (degrees, the viewer's convention) that look straight at each view. */
export const VIEW_ANGLES: Record<ImagePlaneView, { azimuth: number; elevation: number }> = {
  front: { azimuth: 0, elevation: 0 },
  top: { azimuth: 0, elevation: 90 },
  right: { azimuth: 90, elevation: 0 },
}

export const VIEW_LABEL: Record<ImagePlaneView, string> = {
  front: 'Front',
  top: 'Top',
  right: 'Right',
}

export interface Bounds {
  min: Vec3
  max: Vec3
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** A point in the piece's space in a view's 2D axes. */
export const toView = (view: ImagePlaneView, p: Vec3): Vec2 => [
  dot(p, VIEW_AXES[view].right),
  dot(p, VIEW_AXES[view].up),
]

/** A view point back in the piece's space, at the given depth. */
export function fromView(view: ImagePlaneView, [u, v]: Vec2, depth: number): Vec3 {
  const { right, up, depth: axis } = VIEW_AXES[view]
  const p: Vec3 = [right[0] * u + up[0] * v, right[1] * u + up[1] * v, right[2] * u + up[2] * v]
  p[axis] = depth
  return p
}

/** The depth a view's pictures lie at: the middle of the piece (0 with nothing built yet). */
export const planeDepth = (view: ImagePlaneView, bounds: Bounds | null): number =>
  bounds ? (bounds.min[VIEW_AXES[view].depth] + bounds.max[VIEW_AXES[view].depth]) / 2 : 0

/** The picture's height in mm. `aspect` is height / width of the picture. */
export const planeHeight = (plane: Pick<ImagePlane, 'width'>, aspect: number): number =>
  plane.width * aspect

/**
 * Where a newly placed picture goes: centred on the piece as this view sees it, tall enough to
 * hold the piece with room around it (the designer then scales it exactly).
 */
export function initialPlane(
  view: ImagePlaneView,
  bounds: Bounds | null,
  aspect: number,
): ImagePlane {
  const [u0, v0] = bounds ? toView(view, bounds.min) : [-10, -10]
  const [u1, v1] = bounds ? toView(view, bounds.max) : [10, 10]
  const extentU = Math.abs(u1 - u0) || 20
  const extentV = Math.abs(v1 - v0) || 20
  // Fit 1.6× the piece's extent in both directions.
  const width = Math.max(extentU * 1.6, (extentV * 1.6) / Math.max(aspect, 1e-3))
  return {
    view,
    center: [round((u0 + u1) / 2), round((v0 + v1) / 2)],
    width: round(Math.min(Math.max(width, 2), 2000)),
    opacity: 0.6,
    locked: false,
  }
}

/** Moves a picture by a drag in view mm. */
export const moveBy = (plane: ImagePlane, du: number, dv: number): ImagePlane => ({
  ...plane,
  center: [round(plane.center[0] + du), round(plane.center[1] + dv)],
})

/**
 * Scales a picture so that the distance between two points clicked on it becomes `realMm`,
 * keeping the first point where it is (what was under the first click stays under it).
 * Null when the points are too close to measure.
 */
export function scaleByTwoPoints(
  plane: ImagePlane,
  a: Vec2,
  b: Vec2,
  realMm: number,
): ImagePlane | null {
  const measured = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (measured < 1e-3 || !(realMm > 0)) return null
  const k = realMm / measured
  const width = plane.width * k
  if (width > 2000 || width < 0.01) return null
  return {
    ...plane,
    width: round(width),
    center: [
      round(a[0] + (plane.center[0] - a[0]) * k),
      round(a[1] + (plane.center[1] - a[1]) * k),
    ],
  }
}

/** Whether a view point lies on the picture. */
export function onPlane(plane: ImagePlane, aspect: number, [u, v]: Vec2): boolean {
  return (
    Math.abs(u - plane.center[0]) <= plane.width / 2 &&
    Math.abs(v - plane.center[1]) <= planeHeight(plane, aspect) / 2
  )
}

/** Micrometre precision is plenty and keeps stored values short. */
const round = (x: number) => Math.round(x * 1000) / 1000

/** Known sizes to scale against: round diamonds by carat (ideal cut, typical diameters). */
export const KNOWN_SIZES: { label: string; mm: number }[] = [
  { label: '0.25 ct round · 4.1 mm', mm: 4.1 },
  { label: '0.5 ct round · 5.2 mm', mm: 5.2 },
  { label: '0.75 ct round · 5.8 mm', mm: 5.8 },
  { label: '1 ct round · 6.5 mm', mm: 6.5 },
  { label: '1.5 ct round · 7.4 mm', mm: 7.4 },
  { label: '2 ct round · 8.2 mm', mm: 8.2 },
]
