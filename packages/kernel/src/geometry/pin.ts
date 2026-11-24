/** Round pins with a domed head: pavé beads, small claws between stones, posts. */
import { draw, type Shape3D } from 'replicad'
import { lazySolid, type Solid } from '../core'
import { transformShape } from '../solid/occt'
import { circleLoop } from './loop'
import { placeLoop, poleSection, sweepRecipe } from './sweep'
import { addScaled, frameFromZ, frameMatrix, type Vec3 } from './vec'

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
  const sweep = sweepRecipe({ closed: false, sections, kinks: [1] })
  return lazySolid({
    ...sweep,
    // A design can carry hundreds of pins. As a turned profile each is three analytic faces
    // (disc, cylinder, sphere) — a fraction of the STEP size of a NURBS sweep.
    brep: () => {
      const d = Math.SQRT1_2 * radius
      const profile = draw([0, 0])
        .lineTo([radius, 0])
        .lineTo([radius, length])
        .threePointsArcTo([0, length + radius], [d, length + d])
        .close()
      const turned = profile.sketchOnPlane('XZ').revolve([0, 0, 1]) as Shape3D
      try {
        return transformShape(turned, frameMatrix(frame))
      } finally {
        turned.delete()
      }
    },
  })
}
