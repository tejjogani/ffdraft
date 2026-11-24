/**
 * Production geometry for a pavé field, built in two batch Manifold calls as the research asks
 * (06-freeform.md §5 step 8): one union of every seat (the core's stone-shaped seat cutter,
 * opened to the surface, plus a drill hole), and one union of every bead. Each distinct stone
 * size is cut once and instanced by matrix, so thousands of seats cost one tessellation per size.
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

/** All seats as one Manifold (the caller owns it). */
export function seatCutters(stones: readonly Stone[], spec: SeatSpec, quality: Quality): Manifold {
  const { manifold: mf } = runtime()
  const units = new Map<number, Manifold>()
  const placed: Manifold[] = []
  try {
    for (const stone of stones) {
      const key = Math.round(stone.dims.width * 1000)
      let unit = units.get(key)
      if (!unit) {
        unit = unitSeat({ ...stone, frame: WORLD }, spec, quality)
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

/** Seat + drill hole for one stone at the origin, girdle on z = 0, table toward +z. */
function unitSeat(stone: Stone, spec: SeatSpec, quality: Quality): Manifold {
  const { manifold: mf } = runtime()
  const seat = seatCutter(stone, { open: spec.opening })
  // Blind hole one stone deep below the culet: light and cleaning without weakening thin parts.
  const hole = seatHole(stone, stone.dims.width * RULES.seatHole, stone.dims.width)
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
        const segments = Math.max(
          12,
          Math.min(32, Math.ceil(Math.PI / Math.acos(Math.max(0, 1 - quality.chord / r)))),
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
