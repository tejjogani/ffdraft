/**
 * Production geometry for a pavé field, built in two batch Manifold calls as the research asks
 * (06-freeform.md §5 step 8): one union of every seat (the core's stone-shaped seat cutter,
 * opened to the surface, plus a drill hole), and one union of every bead. Each distinct stone
 * size and hole depth is cut once and instanced by matrix, so thousands of seats cost a handful
 * of tessellations.
 */
import type { Manifold } from 'manifold-3d'
import type { Quality, Stone } from '../../core'
import { seatCutter, seatHole } from '../../gems/cutter'
import { frameMatrix, WORLD } from '../../geometry/vec'
import { RULES } from '../../rules'
import { runtime } from '../../runtime/index'
import type { Bead } from './beads'

export interface SeatSpec {
  /** How far above the girdle the seat stays open (to clear the surface), mm. */
  opening: number
}

export interface Seat {
  stone: Stone
  /** Depth of the blind drill hole below the culet, mm (0: none). */
  hole: number
}

/** Hole depths are rounded down to this step (mm) so seats of one size share a few units. */
const HOLE_STEP = 0.1
/**
 * Chord tolerance (mm) for the instanced seat and bead units. Every stone carries a copy of
 * each, so their triangles multiply the fused mesh (about 540 per stone at the finest chord);
 * a hundredth of a millimetre is below what casting and polishing keep.
 */
const UNIT_TOLERANCE = 0.01

/**
 * Triangles a stone adds to the fused body, roughly: its seat and hole, and its share of
 * beads. Used to keep a fully iced piece within what a browser can boolean (see pave.ts).
 */
export const TRIANGLES_PER_SEAT = 95
export const TRIANGLES_PER_HOLE = 110
export const TRIANGLES_PER_BEAD = 70

/** Thousands of copies: facets finer than UNIT_TOLERANCE (or 0.5 rad) are lost in casting anyway. */
const unitQuality = (q: Quality): Quality => ({
  chord: Math.max(q.chord, UNIT_TOLERANCE),
  angle: Math.max(q.angle, 0.5),
})

/** All seats as one Manifold (the caller owns it). */
export function seatCutters(seats: readonly Seat[], spec: SeatSpec, quality: Quality): Manifold {
  const { manifold: mf } = runtime()
  const units = new Map<string, Manifold>()
  const placed: Manifold[] = []
  try {
    for (const { stone, hole } of seats) {
      const steps = Math.floor(hole / HOLE_STEP + 1e-9)
      const key = `${Math.round(stone.dims.width * 1000)}:${steps}`
      let unit = units.get(key)
      if (!unit) {
        const q = unitQuality(quality)
        const exact = unitSeat({ ...stone, frame: WORLD }, steps * HOLE_STEP, spec, q)
        unit = exact.simplify(q.chord)
        exact.delete()
        units.set(key, unit)
      }
      placed.push(
        unit.transform(frameMatrix(stone.frame) as unknown as Parameters<Manifold['transform']>[0]),
      )
    }
    return mf.Manifold.union(placed)
  } finally {
    for (const m of placed) m.delete()
    for (const m of units.values()) m.delete()
  }
}

/**
 * Seat + drill hole for one stone at the origin, girdle on z = 0, table toward +z. The hole is
 * blind: as deep below the culet as the layout found metal for (light and cleaning), always
 * stopping short of the far wall, so it never breaks through or meets a seat from the other side.
 */
function unitSeat(stone: Stone, depth: number, spec: SeatSpec, quality: Quality): Manifold {
  const seat = seatCutter(stone, { open: spec.opening })
  if (depth <= 0) {
    try {
      return seat.manifold(quality).translate([0, 0, 0])
    } finally {
      seat.dispose()
    }
  }
  const { manifold: mf } = runtime()
  const hole = seatHole(stone, stone.dims.width * RULES.seatHole, depth)
  try {
    return mf.Manifold.union([seat.manifold(quality), hole.manifold(quality)])
  } finally {
    seat.dispose()
    hole.dispose()
  }
}

/**
 * All beads as one Manifold. A bead stands about 70 % proud of the surface
 * (02-production.md: beads 0.4–0.5 mm, ≈70 % visible).
 */
export function beadSolids(beads: readonly Bead[], quality: Quality): Manifold {
  const { manifold: mf } = runtime()
  const units = new Map<number, Manifold>()
  const placed: Manifold[] = []
  try {
    for (const b of beads) {
      const r = b.diameter / 2
      const key = Math.round(b.diameter * 1000)
      let unit = units.get(key)
      if (!unit) {
        const chord = Math.max(quality.chord, UNIT_TOLERANCE)
        const segments = Math.max(
          8,
          Math.min(32, Math.ceil(Math.PI / Math.acos(Math.max(0, 1 - chord / r)))),
        )
        unit = mf.Manifold.sphere(r, segments)
        units.set(key, unit)
      }
      const lift = 0.2 * b.diameter
      placed.push(
        unit.translate([
          b.position[0] + b.normal[0] * lift,
          b.position[1] + b.normal[1] * lift,
          b.position[2] + b.normal[2] * lift,
        ]),
      )
    }
    return mf.Manifold.union(placed)
  } finally {
    for (const m of placed) m.delete()
    for (const m of units.values()) m.delete()
  }
}
