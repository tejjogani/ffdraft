/** Shared construction helpers for the procedural built-in models. */
import type { Manifold } from 'manifold-3d'
import type { Solid } from '../core'
import { circleLoop } from '../geometry/loop'
import { placeLoop, poleSection, sweepSolid } from '../geometry/sweep'
import { type Vec3, addScaled, cross, frameFromZ, normalize, sub } from '../geometry/vec'
import { parseSvgPath } from '../mesh/outline/svgPath'
import { runtime } from '../runtime/index'
import { QUALITY } from '../solid/solid'

/** Flattening tolerance of profiles, mm (well below the draft chord). */
const PROFILE_TOLERANCE = 0.005

/**
 * Revolves a closed profile written as SVG path data in the (radius, height) half-plane about
 * the Z axis. Writing profiles as path data keeps every silhouette readable and editable.
 */
export function lathe(profile: string, segments: number): Manifold {
  const { manifold: mf } = runtime()
  const section = new mf.CrossSection(parseSvgPath(profile, PROFILE_TOLERANCE), 'NonZero')
  try {
    return section.revolve(segments)
  } finally {
    section.delete()
  }
}

/** A box of `size` resting on z = `z0`, centred in X and Y, its top edges chamfered by `chamfer`. */
export function chamferedBlock(size: Vec3, z0: number, chamfer: number): Manifold {
  const { manifold: mf } = runtime()
  const [x, y, h] = [size[0] / 2, size[1] / 2, size[2]]
  const c = Math.min(chamfer, x, y, h)
  const corners: Vec3[] = []
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      corners.push([sx * x, sy * y, z0], [sx * x, sy * y, z0 + h - c], [sx * (x - c), sy * (y - c), z0 + h])
  return mf.Manifold.hull(corners.map((p) => [...p] as [number, number, number]))
}

/**
 * A round tube along a cubic Bézier with a radius tapering from `r0` to `r1`, closed by domes
 * at both ends — handles, scrolls and wires. Built as an exact sweep and returned as a mesh.
 */
export function bezierTube(p: readonly [Vec3, Vec3, Vec3, Vec3], r0: number, r1: number, stations = 48): Manifold {
  const point = (t: number): Vec3 => {
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    return [0, 1, 2].map((k) => a * p[0][k]! + b * p[1][k]! + c * p[2][k]! + d * p[3][k]!) as unknown as Vec3
  }
  const tangent = (t: number): Vec3 => normalize(sub(point(Math.min(1, t + 1e-4)), point(Math.max(0, t - 1e-4))))
  // The normal of the control polygon's plane is perpendicular to every tangent of a planar
  // curve, so sections built around it never flip or twist.
  const side = normalize(cross(sub(p[1], p[0]), sub(p[3], p[0])), [0, 1, 0])
  const loopAt = (t: number) => circleLoop(r0 + (r1 - r0) * t)
  const sections: Float64Array[] = []
  const segments = loopAt(0).length
  sections.push(poleSection([...addScaled(point(0), tangent(0), -r0 * 0.9)] as [number, number, number], segments))
  for (let i = 0; i <= stations; i++) {
    const t = i / stations
    sections.push(placeLoop(frameFromZ(point(t), tangent(t), side), loopAt(t)))
  }
  sections.push(poleSection([...addScaled(point(1), tangent(1), r1 * 0.9)] as [number, number, number], segments))
  const solid: Solid = sweepSolid({ sections, closed: false })
  try {
    // A moved handle shares the mesh but is independently owned, so it outlives the solid.
    return solid.manifold(QUALITY.draft).translate([0, 0, 0])
  } finally {
    solid.dispose()
  }
}
