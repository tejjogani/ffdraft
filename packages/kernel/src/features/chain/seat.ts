/**
 * Where a chain rests in a bail: the clear hole of the bail measured around its `opening`
 * frame, and the highest place the chain's section fits in it.
 *
 * The hole is sampled in the frame's yz plane (x is the way the chain threads): straight up and
 * down from the frame's origin to its top and bottom, then sideways at a stack of levels. That
 * works for any bail shape whose hole is open along x, which is what a bail is for.
 */
import type { Manifold } from 'manifold-3d'
import type { Body, Frame, Quality, Vec3 } from '../../core'
import { addScaled } from '../../geometry/vec'

/**
 * A chain's section as it hangs through a bail: half-extents up the opening and across it.
 * Wire links round off at the corners of that box (their outline seen end on fits the
 * ellipse); tennis boxes fill it.
 */
export interface ChainSection {
  up: number
  across: number
  round: boolean
}

export interface HoleProfile {
  /** Heights of the hole's top and bottom above the frame's origin (bottom is negative). */
  top: number
  bottom: number
  /** Clear distance to either side (−y, +y) at each sampled height, rising. */
  levels: { z: number; left: number; right: number }[]
}

/** Levels sampled up the hole: fine enough to follow a teardrop's narrowing top. */
const LEVELS = 40
/** How far a probe looks for metal, mm (far beyond any bail). */
const PROBE = 100

/** Distance along `dir` from `from` to the nearest metal, or Infinity. */
function nearest(meshes: readonly Manifold[], from: Vec3, dir: Vec3): number {
  const to = addScaled(from, dir, PROBE)
  let best = Infinity
  for (const m of meshes) {
    for (const hit of m.rayCast([...from], [...to]))
      best = Math.min(best, Math.hypot(...hit.position.map((v, k) => v - from[k]!)))
  }
  return best
}

/** The bail's clear hole around `opening`, or null when it is not closed above and below. */
export function holeProfile(
  bodies: readonly Body[],
  opening: Frame,
  quality: Quality,
): HoleProfile | null {
  const meshes = bodies.map((b) => b.solid.manifold(quality))
  const { origin, y, z } = opening
  const top = nearest(meshes, origin, z)
  const down = nearest(meshes, origin, [-z[0], -z[1], -z[2]])
  if (!Number.isFinite(top) || !Number.isFinite(down)) return null
  const levels = Array.from({ length: LEVELS }, (_, i) => {
    const h = -down + ((i + 0.5) / LEVELS) * (top + down)
    const at = addScaled(origin, z, h)
    return {
      z: h,
      left: nearest(meshes, at, [-y[0], -y[1], -y[2]]),
      right: nearest(meshes, at, y),
    }
  })
  return { top, bottom: -down, levels }
}

/** The hole's clear height on its axis and its widest clear width. */
export function clearSpan(hole: HoleProfile): { height: number; width: number } {
  return {
    height: hole.top - hole.bottom,
    width: Math.max(...hole.levels.map((l) => l.left + l.right)),
  }
}

/** Half the width a section needs at height `dz` above its centre. */
function halfWidth(section: ChainSection, dz: number): number {
  const t = Math.min(1, Math.abs(dz) / section.up)
  return section.round ? section.across * Math.sqrt(1 - t * t) : section.across
}

/**
 * The highest height for the centre of a chain section at which it stays `clearance` clear of
 * the hole all round, given that the hung chain rises `sag` higher where it leaves the bail (it
 * is the low point of a curve that climbs either side toward the neck). Gravity seats a hung
 * chain against the top of the hole, but never in a part narrower than the chain. Null when it
 * does not fit.
 */
export function seatHeight(
  hole: HoleProfile,
  section: ChainSection,
  clearance: number,
  sag: number,
): number | null {
  const step = (hole.top - hole.bottom) / LEVELS / 2
  for (let c = hole.top - section.up - sag - clearance; ; c -= step) {
    const lo = c - section.up - clearance
    if (lo < hole.bottom) return null
    const hi = c + section.up + sag + clearance
    const fits = hole.levels.every((l) => {
      if (l.z < lo || l.z > hi) return true
      // Above the centre the climbing ends sweep the section up by up to `sag`.
      const dz = l.z > c ? Math.max(0, l.z - c - sag) : c - l.z
      const need = halfWidth(section, dz) + clearance
      return l.left >= need && l.right >= need
    })
    if (fits) return c
  }
}
