/**
 * Seat cutters: the solids removed from metal so a stone can sit in it. A cutter follows the
 * stone's own silhouette (outline and levels), slightly undersized — the setter opens the seat
 * to the actual stone (docs/research/02-production.md §3).
 */
import type { Solid, Stone } from '../core'
import { circleLoop, scaleLoop } from '../geometry/loop'
import { placeLoop, poleSection, sweepSolid } from '../geometry/sweep'
import { type Frame, addScaled, fromFrame } from '../geometry/vec'
import { RULES } from '../rules'
import { gemUnit, stackLoop } from './index'

export interface SeatOptions {
  /** Cutter size across the girdle relative to the stone. Default 0.98. */
  scale?: number
  /**
   * Extend the cutter straight up from the girdle by this many mm, so the stone can be dropped
   * in from above (pavé, channel, flush). When omitted the cutter follows the crown instead,
   * which leaves the metal over the crown — claws and bezel lips — intact.
   */
  open?: number
  /** Extra depth below the culet, mm. */
  below?: number
}

/** The stone-shaped cutter for one stone. */
export function seatCutter(stone: Stone, options: SeatOptions = {}): Solid {
  const unit = gemUnit(stone.cut, stone.dims.length / stone.dims.width)
  const k = options.scale ?? RULES.seatScale
  const sx = stone.dims.width * k
  const sy = (stone.dims.length / unit.length) * k
  const sz = stone.dims.depth / unit.depth
  const at = (z: number): Frame => ({ ...stone.frame, origin: addScaled(stone.frame.origin, stone.frame.z, z) })
  const section = (levelIndex: number, z: number): Float64Array => {
    const level = unit.stack[levelIndex]!
    return placeLoop(at(z), scaleLoop(stackLoop(unit, level), sx, sy))
  }
  const segments = stackLoop(unit, unit.stack[0]!).length
  const sections: Float64Array[] = []
  const girdleTop = unit.stack.findIndex((l, i) => i > 0 && l.scale === 1 && unit.stack[i - 1]!.scale === 1)
  unit.stack.forEach((level, i) => {
    if (options.open !== undefined && i > girdleTop) return
    const z = level.z * sz - (i === 0 ? (options.below ?? 0) : 0)
    if (level.scale < 1e-6) {
      const [cx, cy] = unit.outline.centre
      sections.push(poleSection(fromFrame(at(z), [cx * sx, cy * sy, 0]), segments))
    } else sections.push(section(i, z))
  })
  if (options.open !== undefined) sections.push(section(girdleTop, Math.max(options.open, unit.stack[girdleTop]!.z * sz + 0.05)))
  // Every level is a crease: cone, girdle band, crown (or opening) are separate ruled faces.
  return sweepSolid({ closed: false, sections, kinks: sections.map((_, i) => i) })
}

/** A round drill hole along the stone's axis, from just above the culet down by `depth` mm. */
export function seatHole(stone: Stone, diameter: number, depth: number): Solid {
  const unit = gemUnit(stone.cut, stone.dims.length / stone.dims.width)
  const culet = (unit.bottom / unit.depth) * stone.dims.depth
  const [cx, cy] = unit.outline.centre
  const axis = (z: number): Frame => ({
    ...stone.frame,
    origin: fromFrame(stone.frame, [cx * stone.dims.width, (cy * stone.dims.length) / unit.length, z]),
  })
  // Start a third of the way up the pavilion so the hole always breaks into the seat.
  const top = culet * 0.67
  return sweepSolid({
    closed: false,
    sections: [placeLoop(axis(culet - depth), circleLoop(diameter / 2)), placeLoop(axis(top), circleLoop(diameter / 2))],
  })
}
