/**
 * Ring coordinates. A ring is centred on the origin with the finger along Y; a point is
 * (θ, a, r): θ around the finger from the top of the ring (+Z) toward +X, a along the finger,
 * r from the finger's axis.
 */
import type { Frame, Vec3 } from './vec'

export const ringPoint = (theta: number, a: number, r: number): Vec3 => [
  r * Math.sin(theta),
  a,
  r * Math.cos(theta),
]

/** Unit vector pointing away from the finger at θ. */
export const ringRadial = (theta: number): Vec3 => [Math.sin(theta), 0, Math.cos(theta)]

/** Unit vector along increasing θ. */
export const ringTangent = (theta: number): Vec3 => [Math.cos(theta), 0, -Math.sin(theta)]

/**
 * Frame for a cross-section of the band at θ: x along the finger, y radial, z along the band.
 * A profile drawn in (a, r) and placed on this frame lands where `ringPoint` says.
 */
export const ringSectionFrame = (theta: number): Frame => ({
  origin: [0, 0, 0],
  x: [0, 1, 0],
  y: ringRadial(theta),
  z: ringTangent(theta),
})

/**
 * Frame for something standing on the ring at θ, a, r: z radial (out of the finger), y along
 * the finger, x along the band — the orientation of a stone set on a band.
 */
export const ringSurfaceFrame = (theta: number, a: number, r: number): Frame => ({
  origin: ringPoint(theta, a, r),
  x: ringTangent(theta),
  y: [0, 1, 0],
  z: ringRadial(theta),
})

/** Wraps an angle to (−π, π]. */
export const wrapAngle = (theta: number): number => {
  const t = ((((theta + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
  return t === -Math.PI ? Math.PI : t
}
