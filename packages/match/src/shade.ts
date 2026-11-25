/**
 * Shaded clay pictures from the software rasteriser: what the server shows the assistant when no
 * studio window can draw the piece (`viewport.capture` without a window), and the synthetic
 * "photos" of the tests, whose truth is known. Flat Lambert shading per triangle under a key and a
 * fill light fixed to the camera, metal in warm grey and stones in pale blue on a light ground.
 * It is a draughtsman's picture, not a render: outlines and proportions read correctly, metal
 * and stone materials do not.
 */
import type { Evaluation } from '@pave/kernel/types'
import { cameraBasis, defaultCamera, VIEW_SEEDS, type ViewSeed } from './camera'
import { rasterize, triangleAt } from './raster'
import type { Camera, Size, Vec3 } from './types'

export interface ShadeOptions {
  /** Ground colour behind the piece. */
  background?: [number, number, number]
  metal?: [number, number, number]
  stone?: [number, number, number]
  /** Nodes drawn in the accent colour (the features a capture focuses on). */
  focus?: readonly string[]
  accent?: [number, number, number]
  hide?: string[]
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** RGBA pixels of `e` seen through `c`. */
export function shade(e: Evaluation, c: Camera, size: Size, o: ShadeOptions = {}): Uint8Array {
  const hide = o.hide ?? []
  const r = rasterize(e, c, size, { face: true, hide })
  const bgc = o.background ?? [244, 243, 240]
  const metal = o.metal ?? [196, 190, 180]
  const stone = o.stone ?? [196, 214, 236]
  const accent = o.accent ?? [222, 150, 96]
  const focus = new Set(o.focus ?? [])
  const { right, up, back } = cameraBasis(c.azimuth, c.elevation)
  // Lights in world space, fixed to the camera: a key from the upper left, a weaker fill.
  const toWorld = (x: number, y: number, z: number): Vec3 =>
    norm([
      x * right[0] + y * up[0] + z * back[0],
      x * right[1] + y * up[1] + z * back[1],
      x * right[2] + y * up[2] + z * back[2],
    ])
  const key = toWorld(-0.5, 0.7, 0.6)
  const fill = toWorld(0.6, -0.2, 0.8)
  const brightness = new Map<number, number>()
  const nodeOf = new Map<number, string>()
  const lightFor = (face: number): number => {
    const hit = brightness.get(face)
    if (hit !== undefined) return hit
    const t = triangleAt(e, face, hide)
    const u: Vec3 = [t.b[0] - t.a[0], t.b[1] - t.a[1], t.b[2] - t.a[2]]
    const v: Vec3 = [t.c[0] - t.a[0], t.c[1] - t.a[1], t.c[2] - t.a[2]]
    let n = norm([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]])
    // Meshes may be open or wound either way: light the side that faces the camera.
    if (n[0] * back[0] + n[1] * back[1] + n[2] * back[2] < 0) n = [-n[0], -n[1], -n[2]]
    const d = (l: Vec3) => Math.max(0, n[0] * l[0] + n[1] * l[1] + n[2] * l[2])
    const b = Math.min(1.15, 0.28 + 0.62 * d(key) + 0.3 * d(fill))
    brightness.set(face, b)
    nodeOf.set(face, t.nodeId)
    return b
  }
  const out = new Uint8Array(size.width * size.height * 4)
  const face = r.face!
  for (let k = 0; k < r.cls.length; k++) {
    const p = k * 4
    const cls = r.cls[k]!
    if (!cls) {
      out[p] = bgc[0]
      out[p + 1] = bgc[1]
      out[p + 2] = bgc[2]
      out[p + 3] = 255
      continue
    }
    const b = lightFor(face[k]!)
    const base = focus.size && focus.has(nodeOf.get(face[k]!)!) ? accent : cls === 2 ? stone : metal
    out[p] = Math.min(255, Math.round(base[0] * b))
    out[p + 1] = Math.min(255, Math.round(base[1] * b))
    out[p + 2] = Math.min(255, Math.round(base[2] * b))
    out[p + 3] = 255
  }
  return out
}

/**
 * The camera of a named or orbit view, framed like the studio's captures: the visible bounds
 * filling about two thirds of the frame, from far enough away for a mild perspective.
 */
export function viewCamera(
  e: Evaluation,
  view: ViewSeed | 'three-quarter' | 'hero' | 'macro' | { azimuth: number; elevation: number },
  o: { hide?: string[] } = {},
): Camera {
  const base = defaultCamera(e, 'front', { distanceRatio: 6, ...(o.hide ? { hide: o.hide } : {}) })
  const [azimuth, elevation] =
    typeof view === 'object'
      ? [view.azimuth, view.elevation]
      : view === 'three-quarter'
        ? VIEW_SEEDS.threeQuarter
        : view === 'hero'
          ? [35, 24]
          : view === 'macro'
            ? [28, 32]
            : VIEW_SEEDS[view]
  return { ...base, azimuth, elevation }
}
