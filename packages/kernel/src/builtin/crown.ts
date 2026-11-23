/**
 * A king's crown: a circlet whose wall rises into eight tapering points, each tipped with a
 * ball, on a rolled band with a raised bead line — the silhouette of every hip-hop crown
 * pendant. About 22 mm across; meshBody rescales it.
 */
import type { Manifold } from 'manifold-3d'
import { runtime } from '../runtime/index'
import { manifoldFromTriangles } from '../solid/solid'
import { lathe } from './lathe'

const RADIUS = 11
const WALL = 1.1
const BAND = 3.4
const POINTS = 8
const POINT_HEIGHT = 10
/** Higher values give slimmer points with deeper, rounder valleys between them. */
const TAPER = 1.8
const SEGMENTS = 384

/** Wall height above the band at angle θ: a scalloped row of points. */
function crest(theta: number): number {
  const t = ((theta * POINTS) / (2 * Math.PI)) % 1
  const w = 1 - Math.abs(2 * t - 1)
  return BAND + POINT_HEIGHT * w ** TAPER
}

/** The circlet wall as a closed ring: outer and inner faces, crest on top, flat underneath. */
function wall(): Manifold {
  const positions: number[] = []
  const indices: number[] = []
  const ro = RADIUS
  const ri = RADIUS - WALL
  for (let i = 0; i < SEGMENTS; i++) {
    const theta = (i / SEGMENTS) * 2 * Math.PI
    const c = Math.cos(theta)
    const s = Math.sin(theta)
    const top = crest(theta)
    // Per segment: outer bottom, outer top, inner top, inner bottom.
    positions.push(ro * c, ro * s, 0, ro * c, ro * s, top, ri * c, ri * s, top, ri * c, ri * s, 0)
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * 4
    const b = ((i + 1) % SEGMENTS) * 4
    // Four quads around the section, each wound outward.
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4
      indices.push(a + k, b + k, b + k1, a + k, b + k1, a + k1)
    }
  }
  return manifoldFromTriangles({ positions: Float32Array.from(positions), indices: Uint32Array.from(indices) })
}

export function crown(): Manifold {
  const { manifold: mf } = runtime()
  const parts: Manifold[] = [wall()]
  // Rolled band at the foot and a bead line above it.
  parts.push(lathe(`M ${RADIUS - WALL * 0.5} 0 L ${RADIUS + 0.4} 0 C ${RADIUS + 1.3} 0 ${RADIUS + 1.3} 1.6 ${RADIUS + 0.4} 1.6 L ${RADIUS - WALL * 0.5} 1.6 Z`, 192))
  parts.push(lathe(`M ${RADIUS - WALL * 0.5} 2.3 L ${RADIUS + 0.3} 2.3 C ${RADIUS + 0.9} 2.3 ${RADIUS + 0.9} 3.2 ${RADIUS + 0.3} 3.2 L ${RADIUS - WALL * 0.5} 3.2 Z`, 192))
  const ball = mf.Manifold.sphere(1.05, 32)
  for (let k = 0; k < POINTS; k++) {
    const theta = ((k + 0.5) / POINTS) * 2 * Math.PI
    parts.push(ball.translate([(RADIUS - WALL / 2) * Math.cos(theta), (RADIUS - WALL / 2) * Math.sin(theta), BAND + POINT_HEIGHT + 0.5]))
  }
  try {
    // A point faces the viewer (−Y).
    const united = mf.Manifold.union(parts)
    try {
      return united.rotate([0, 0, -90 - 180 / POINTS])
    } finally {
      united.delete()
    }
  } finally {
    ball.delete()
    for (const p of parts) p.delete()
  }
}
