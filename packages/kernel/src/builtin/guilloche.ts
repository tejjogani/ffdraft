/**
 * The relief used when no image is given: an engine-turned (guilloché) medallion — a polished
 * domed boss ringed by a fine bead line, inside a field of wavy sunburst rays that catch the
 * light as the piece moves, fading to a plain band before the rim.
 */
import { smoothstep } from '../geometry/vec'

const RAYS = 36
/** Radial wave of the rays: how many waves from the boss to the edge, and their swing (radians). */
const WAVES = 1.5
const SWING = 0.55
const BOSS = 0.27
const BEAD_RING = 0.33
const BEADS = 28

/** Height 0–1 at (u, v), both −1…1 across the field (an ellipse inscribed in that square). */
export function guilloche(u: number, v: number): number {
  const r = Math.hypot(u, v)
  const theta = Math.atan2(v, u)
  // Domed boss, slightly flattened on top like a struck coin.
  const boss = r < BOSS ? 0.92 * Math.sqrt(1 - (r / BOSS) ** 2) ** 0.7 : 0
  // A ring of round beads just outside the boss.
  const ringAngle = Math.round((theta / (2 * Math.PI)) * BEADS) * ((2 * Math.PI) / BEADS)
  const bead = Math.hypot(
    r * Math.cos(theta) - BEAD_RING * Math.cos(ringAngle),
    r * Math.sin(theta) - BEAD_RING * Math.sin(ringAngle),
  )
  const beads = bead < 0.028 ? 0.45 * Math.sqrt(1 - (bead / 0.028) ** 2) : 0
  // Wavy rays between the bead ring and the plain outer band.
  const phase = RAYS * theta + SWING * RAYS * 0.1 * Math.sin(2 * Math.PI * WAVES * r)
  const rays = 0.5 + 0.5 * Math.cos(phase)
  const field = smoothstep((r - 0.38) / 0.06) * (1 - smoothstep((r - 0.84) / 0.06))
  return Math.max(boss, beads, 0.12 + 0.28 * rays * field)
}
