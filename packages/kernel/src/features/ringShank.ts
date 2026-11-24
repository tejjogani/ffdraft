/**
 * Ring band: a cross-section carried around the finger as one NURBS sweep.
 *
 * Width and thickness blend smoothly between their values at the top and the base; cathedral
 * shoulders and a euro base are modulations of the thickness; a split shank is two strands
 * that share the lower half of the ring and part toward the head.
 */
import { cathedralPeak, MOUNT, type NodeOf, ringInnerDiameter } from '@pave/schema'
import { type Body, defineFeature, metalOf, type NodeResult } from '../core'
import { type BandProfile, bandLoop, bandOuterAt } from '../geometry/bandProfile'
import { ringSectionFrame, wrapAngle } from '../geometry/ring'
import { placeLoop, sweepSolid } from '../geometry/sweep'
import { DEG, lerp, smootherstep } from '../geometry/vec'
import { RULES } from '../rules'

type ShankNode = NodeOf<'ringShank'>

/** What features that sit on a band need to know about it, in the band's own space. */
export interface ShankData {
  kind: 'ringShank'
  /** Finger radius: the smallest radius of the bore. */
  innerRadius: number
  profile: BandProfile
  /** Overall width of the band at θ (radians from the top, positive toward +X). */
  width(theta: number): number
  /** Radial thickness at the band's centre line. */
  thickness(theta: number): number
  /** Open gap between the strands of a split shank (0 elsewhere). */
  gap(theta: number): number
  /** Radius of the outer surface at θ, `a` mm off the centre line, and its slope dr/da there. */
  outer(theta: number, a?: number): { radius: number; slope: number }
}

export function shankData(result: NodeResult): ShankData {
  const data = result.data as ShankData | undefined
  if (data?.kind !== 'ringShank') throw new Error(`“${result.id}” is not a ring band`)
  return data
}

/** Sections around the full ring: every 3.75°, fine enough for shoulders to keep their shape. */
const SECTIONS = 96

/** Where a split shank starts to part, and where the hidden end of the second strand lies. */
const SPLIT_START = 58 * DEG
const SPLIT_BURIED = 66 * DEG

/**
 * Cathedral shoulders: the outer surface leaves the band on a tangent, climbs `rise` to a peak
 * either side of the head and dips between the peaks to cradle the stone's pavilion.
 */
interface Cathedral {
  /** Height of the shoulder's top above the band at θ (0 beyond the arms). */
  rise(theta: number): number
  /** The arms run from the band at ±start up to their peaks at ±peak, radians. */
  start: number
  peak: number
}

/**
 * Cathedral shoulders: two arms that leave the band on a tangent, climb `rise` to a peak either
 * side of the head, just under the stone's girdle, and dip between the peaks to cradle the
 * stone's pavilion. The arms are a strip of the band's own thickness: the space between them
 * and the band is the open arch, so a high rise adds a little metal, not a solid wall.
 */
function cathedral(rise: number, outerRadius: number): Cathedral {
  // Where the peaks stand is the mount rules' (design/mount.ts), which also pick the rise that
  // brings them just under the stone's girdle.
  const { peak } = cathedralPeak(rise, outerRadius)
  // A straight line tangent to the band reaches the peak's height after this angle.
  const start = Math.min(peak + Math.acos(outerRadius / (outerRadius + rise)) * 1.15, 110 * DEG)
  return {
    start,
    peak,
    rise: (theta) => {
      const t = Math.abs(theta)
      if (t >= start) return 0
      if (t >= peak) return rise * smootherstep((start - t) / (start - peak))
      return rise * lerp(0.3, 1, smootherstep(t / peak))
    },
  }
}

/** Euro base: the outer surface runs flat across the bottom and turns two soft corners. */
function euro(outerAtBase: number): (theta: number, outer: number) => number {
  const corner = 26 * DEG
  const end = 56 * DEG
  return (theta, outer) => {
    const phi = Math.PI - Math.abs(theta)
    if (phi >= end) return 0
    const flat = outerAtBase / Math.cos(Math.min(phi, corner))
    return (
      Math.max(0, flat - outer) * (1 - smootherstep((phi - corner * 0.8) / (end - corner * 0.8)))
    )
  }
}

interface Strand {
  /** Angles of the sections, in order; closed strands cover the whole ring. */
  angles: number[]
  closed: boolean
  centre(theta: number): number
  width(theta: number): number
  /** 1 where the strand runs hidden inside another and is drawn a hair smaller, else 0. */
  buried(theta: number): number
  /** Radial thickness, and how far its inside stands off the finger (0: on the finger). */
  thickness(theta: number): number
  lift(theta: number): number
}

function shankShape(node: ShankNode) {
  const innerRadius = ringInnerDiameter(node.size) / 2
  const top = (theta: number) => (1 + Math.cos(theta)) / 2
  const baseWidth = (theta: number) => lerp(node.widthBottom, node.widthTop, top(theta))
  const baseThickness = (theta: number) => lerp(node.thicknessBottom, node.thicknessTop, top(theta))
  const arms =
    node.shoulder === 'cathedral'
      ? cathedral(node.shoulderHeight ?? MOUNT.shoulderRise.none, innerRadius + node.thicknessTop)
      : null
  const base = node.baseShape === 'euro' ? euro(innerRadius + node.thicknessBottom) : () => 0
  /** The band itself, without the arms. */
  const bandThickness = (theta: number) => {
    const t = baseThickness(theta)
    return t + base(theta, innerRadius + t)
  }
  /** To the outer surface: the top of an arm where there is one. */
  const thickness = (theta: number) => bandThickness(theta) + (arms?.rise(theta) ?? 0)

  // Split shank: the strands' outer edges run to ±E and their facing edges to ±I; I < 0 means
  // the strands still overlap (one band), I > 0 is the open gap.
  const split = node.shoulder === 'split'
  const strandTop = Math.max(0.6 * node.widthTop, 0.9)
  const parting = (theta: number) => smootherstep(1 - Math.abs(theta) / SPLIT_START)
  const outerEdge = (theta: number) =>
    split
      ? lerp(baseWidth(theta) / 2, node.splitGap / 2 + strandTop, parting(theta))
      : baseWidth(theta) / 2
  const innerEdge = (theta: number) =>
    lerp(-baseWidth(theta) / 2, node.splitGap / 2, parting(theta))

  const ring = Array.from({ length: SECTIONS }, (_, i) => wrapAngle((i / SECTIONS) * 2 * Math.PI))
  const strands: Strand[] = [
    {
      angles: ring,
      closed: true,
      centre: (t) => (split ? (outerEdge(t) + innerEdge(t)) / 2 : 0),
      width: (t) => (split ? outerEdge(t) - innerEdge(t) : baseWidth(t)),
      buried: () => 0,
      thickness: bandThickness,
      lift: () => 0,
    },
  ]
  if (arms) {
    // The arms are one strip from inside the band on one side, over the peaks and the dip that
    // cradles the stone, to inside the band on the other. Its top sits a hair under the outer
    // surface the rest of the kernel measures, so it never shares a face with the band where
    // the two merge.
    const end = arms.start + 2 * DEG
    const steps = Math.max(16, Math.ceil((2 * end) / (2 * DEG)))
    const armThickness = (t: number) => Math.min(baseThickness(t), thickness(t) - 0.03)
    strands.push({
      angles: Array.from({ length: steps + 1 }, (_, i) => -end + (2 * end * i) / steps),
      closed: false,
      centre: () => 0,
      width: baseWidth,
      buried: () => 0,
      thickness: armThickness,
      lift: (t) => thickness(t) - 0.03 - armThickness(t),
    })
  }
  if (split) {
    const steps = Math.ceil((2 * SPLIT_BURIED) / ((2 * Math.PI) / SECTIONS))
    strands.push({
      angles: Array.from(
        { length: steps + 1 },
        (_, i) => -SPLIT_BURIED + (2 * SPLIT_BURIED * i) / steps,
      ),
      closed: false,
      centre: (t) => -(outerEdge(t) + innerEdge(t)) / 2,
      width: (t) => outerEdge(t) - innerEdge(t),
      // The mirrored strand ends inside the first one and surfaces over the next few degrees.
      buried: (t) => 1 - smootherstep((SPLIT_START - Math.abs(t)) / (8 * DEG)),
      thickness: bandThickness,
      lift: () => 0,
    })
  }
  return {
    innerRadius,
    thickness,
    strands,
    width: (t: number) => 2 * outerEdge(t),
    gap: (t: number) => (split ? 2 * Math.max(0, innerEdge(t)) : 0),
  }
}

export const ringShank = defineFeature('ringShank', (node, ctx) => {
  const shape = shankShape(node)
  const { innerRadius, thickness } = shape
  // Where a strand is buried it is inset by this much all round, so the two strands of a
  // split shank never share a surface (which would flicker in a viewport).
  const INSET = 0.03
  const bodies: Body[] = shape.strands.map((strand) => ({
    solid: sweepSolid({
      closed: strand.closed,
      sections: strand.angles.map((theta) => {
        const inset = INSET * strand.buried(theta)
        return placeLoop(
          ringSectionFrame(theta),
          bandLoop(
            node.profile,
            strand.width(theta) - 2 * inset,
            strand.thickness(theta) - 2 * inset,
            innerRadius + strand.lift(theta) + inset,
            strand.centre(theta),
          ),
        )
      }),
    }),
    ...metalOf(node),
  }))

  // Ring charts run from about 12 mm (child sizes) to 25 mm; outside 10–30 mm the value is a
  // mistake (a size of 0 in mm, US 80), not a finger.
  const diameter = 2 * innerRadius
  if (diameter < 10 || diameter > 30)
    ctx.report({
      level: 'error',
      code: 'ring.size',
      message: `The ring size gives a ${diameter.toFixed(2)} mm inner diameter, outside the 10–30 mm of any finger; check the size and its system.`,
      value: diameter,
      limit: diameter < 10 ? 10 : 30,
    })
  const thinnest = Math.min(node.thicknessTop, node.thicknessBottom)
  if (thinnest < RULES.shankThickness.warn)
    ctx.report({
      level: thinnest < RULES.shankThickness.error ? 'error' : 'warning',
      code: 'shank.thin',
      message: `The band is ${thinnest.toFixed(2)} mm thick; ${RULES.shankThickness.warn} mm is the minimum for daily wear.`,
      value: thinnest,
      limit: RULES.shankThickness.warn,
      at: [0, 0, node.thicknessBottom <= node.thicknessTop ? -innerRadius : innerRadius],
      fix: {
        label: `Thicken the band to ${RULES.shankThickness.warn} mm`,
        ops: [
          {
            t: 'update',
            id: node.id,
            patch: {
              thicknessTop: Math.max(node.thicknessTop, RULES.shankThickness.warn),
              thicknessBottom: Math.max(node.thicknessBottom, RULES.shankThickness.warn),
            },
          },
        ],
      },
    })
  const narrowest = Math.min(node.widthTop, node.widthBottom)
  if (narrowest < RULES.shankWidth.warn)
    ctx.report({
      level: 'warning',
      code: 'shank.narrow',
      message: `The band is ${narrowest.toFixed(2)} mm wide; below ${RULES.shankWidth.warn} mm it bends in wear.`,
      value: narrowest,
      limit: RULES.shankWidth.warn,
    })

  const data: ShankData = {
    kind: 'ringShank',
    innerRadius,
    profile: node.profile,
    width: shape.width,
    thickness,
    gap: shape.gap,
    outer(theta, a = 0) {
      const { height, slope } = bandOuterAt(node.profile, shape.width(theta), thickness(theta), a)
      return { radius: innerRadius + height, slope }
    },
  }
  return { bodies, data }
})
