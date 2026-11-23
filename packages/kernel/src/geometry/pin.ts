/** Round pins with a domed head: pavé beads, small claws between stones, posts. */
import type { Solid } from '../core'
import { circleLoop } from './loop'
import { placeLoop, poleSection, sweepSolid } from './sweep'
import { type Vec3, addScaled, frameFromZ } from './vec'

/**
 * A round pin from `base` along `axis`: a straight shank of `length` mm topped by a hemisphere
 * of the same radius (total height = length + radius).
 */
export function pinSolid(base: Vec3, axis: Vec3, radius: number, length: number): Solid {
  const frame = frameFromZ(base, axis)
  const at = (z: number) => ({ ...frame, origin: addScaled(base, frame.z, z) })
  const sections = [placeLoop(at(0), circleLoop(radius)), placeLoop(at(length), circleLoop(radius))]
  for (const deg of [30, 60]) {
    const a = (deg * Math.PI) / 180
    sections.push(placeLoop(at(length + radius * Math.sin(a)), circleLoop(radius * Math.cos(a))))
  }
  sections.push(poleSection(addScaled(base, frame.z, length + radius), 4))
  // The shank is straight: crease the sweep where the dome starts so it stays a true cylinder.
  return sweepSolid({ closed: false, sections, kinks: [1] })
}
