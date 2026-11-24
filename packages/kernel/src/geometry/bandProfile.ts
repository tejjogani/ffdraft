/**
 * Cross-sections of a ring band, drawn in (a, r): a along the finger, r away from its axis.
 * The lowest point of the inner surface sits exactly on r = inner, so the bore is the finger
 * size whatever the profile.
 */
import {
  arcSegment,
  type Bezier2,
  blendSegment,
  bulgeSegments,
  domeSegments,
  type Loop,
  lineSegment,
  segmentTangent,
} from './loop'
import { clamp } from './vec'

export type BandProfile = 'court' | 'dShape' | 'flat' | 'flatCourt' | 'knifeEdge'

/** Radius that takes the knife edge off every corner — no cast ring has truly sharp edges. */
const edgeRadius = (width: number, thickness: number): number =>
  clamp(0.1 * Math.min(width, thickness), 0.04, 0.25)

/** Comfort-fit crown of the inner surface: how far its edges stand off the finger. */
const comfort = (thickness: number): number => Math.min(0.3, 0.18 * thickness)

/** Height above r = inner at which a domed or ridged top starts (the top of the side wall). */
function wallHeight(profile: BandProfile, width: number, thickness: number): number {
  const base =
    profile === 'knifeEdge'
      ? 0.35 * thickness
      : profile === 'court'
        ? 0.3 * thickness
        : clamp(0.28 * thickness, 0.25, 0.6)
  const ci = profile === 'court' ? comfort(thickness) : 0
  return Math.max(base, ci + edgeRadius(width, thickness) + 0.02)
}

/**
 * The profile as a closed counter-clockwise loop centred on a = `centre`. The number of
 * segments depends only on `profile`, so loops of one profile interpolate along a sweep.
 */
export function bandLoop(
  profile: BandProfile,
  width: number,
  thickness: number,
  inner: number,
  centre = 0,
): Loop {
  const hw = width / 2
  const e = edgeRadius(width, thickness)
  const r0 = inner
  const r1 = inner + thickness
  const q = Math.PI / 2
  const L = centre - hw
  const R = centre + hw
  const rounded = profile === 'court' || profile === 'flatCourt'
  const ci = rounded ? comfort(thickness) : 0

  // Inner surface, left to right, then the lower right corner up to the side wall.
  const innerSegments: Bezier2[] = rounded
    ? bulgeSegments([L + e, r0 + ci], [R - e, r0 + ci], ci, 2)
    : [lineSegment([L + e, r0], [R - e, r0])]
  const cornerRight = rounded
    ? blendSegment(
        [R - e, r0 + ci],
        segmentTangent(innerSegments[innerSegments.length - 1]!, true),
        [R, r0 + ci + e],
        [0, 1],
      )
    : arcSegment([R - e, r0 + e], e, -q, 0)
  const cornerLeft = rounded
    ? blendSegment(
        [L, r0 + ci + e],
        [0, -1],
        [L + e, r0 + ci],
        segmentTangent(innerSegments[0]!, false),
      )
    : arcSegment([L + e, r0 + e], e, 2 * q, 3 * q)
  const wallStart = r0 + ci + e

  let top: Bezier2[]
  if (profile === 'flat' || profile === 'flatCourt') {
    top = [
      lineSegment([R, wallStart], [R, r1 - e]),
      arcSegment([R - e, r1 - e], e, 0, q),
      lineSegment([R - e, r1], [L + e, r1]),
      arcSegment([L + e, r1 - e], e, q, 2 * q),
      lineSegment([L, r1 - e], [L, wallStart]),
    ]
  } else {
    const wall = r0 + wallHeight(profile, width, thickness)
    if (profile === 'knifeEdge') {
      // Two flat slopes meeting in a ridge that is eased over a short blend.
      const slope = Math.hypot(hw, r1 - wall)
      const ux = -hw / slope
      const uy = (r1 - wall) / slope
      const d = Math.min(0.25, slope * 0.25)
      top = [
        lineSegment([R, wallStart], [R, wall]),
        lineSegment([R, wall], [centre - ux * d, r1 - uy * d]),
        blendSegment(
          [centre - ux * d, r1 - uy * d],
          [ux, uy],
          [centre + ux * d, r1 - uy * d],
          [ux, -uy],
        ),
        lineSegment([centre + ux * d, r1 - uy * d], [L, wall]),
        lineSegment([L, wall], [L, wallStart]),
      ]
    } else {
      top = [
        lineSegment([R, wallStart], [R, wall]),
        ...domeSegments([R, wall], [L, wall], r1 - wall),
        lineSegment([L, wall], [L, wallStart]),
      ]
    }
  }
  return [...innerSegments, cornerRight, ...top, cornerLeft]
}

/**
 * Height of the outer surface above r = inner at axial offset `a` from the band's centre, and
 * its slope dr/da — where a stone set off-centre on a domed band sits and how it tilts.
 */
export function bandOuterAt(
  profile: BandProfile,
  width: number,
  thickness: number,
  a: number,
): { height: number; slope: number } {
  const hw = width / 2
  const x = clamp(a / hw, -0.98, 0.98)
  if (profile === 'flat' || profile === 'flatCourt') return { height: thickness, slope: 0 }
  const wall = wallHeight(profile, width, thickness)
  const rise = thickness - wall
  if (profile === 'knifeEdge')
    return { height: wall + rise * (1 - Math.abs(x)), slope: (-Math.sign(x) * rise) / hw }
  const root = Math.sqrt(1 - x * x)
  return { height: wall + rise * root, slope: (-rise * x) / (root * hw) }
}
