/**
 * Walls too thin to cast: a plate a few tenths of a millimetre thick, a long wire of the same
 * section. Measured on each node's own bodies by inward ray casting from area-weighted surface
 * samples (the method of the common print checkers, and of @pave/production's report on the
 * fused part). Each body on its own, not the fused casting: the knife edges seats leave and the
 * hairline partings of touching surfaces read as walls of a hundredth of a millimetre there, and
 * one finding per node is what a designer can act on. Only exact (parametric) bodies are
 * measured: mesh bodies (lettering, imports, reliefs) can hold overlapping shells whose inner
 * faces read as walls, and `meshBody` measures its own walls when it is built. Samples come from a fixed-seed
 * generator: the same piece gives the same findings.
 *
 * Seats, beads and claw tips are thin by design and governed by their own rules, so samples
 * near a stone are skipped; so are chains (bought, and checked by `chain.fine`).
 */
import type { Scene, Solid } from '../core'
import type { Diagnostic } from '../types'
import { treeOf } from './trees'

/** Below this a wall does not fill in casting (the package's error threshold, 02-production §3). */
const MIN_WALL_MM = 0.5
/** Samples per mm² of surface, and at most this many per part: a few ms on a large casting. */
const DENSITY = 6
const MAX_SAMPLES = 4000
/** A finding needs two thin readings: one ray can graze a crease. */
const MIN_READINGS = 2

/** mulberry32: tiny, fast, deterministic. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function wallChecks(scene: Scene): Diagnostic[] {
  if (scene.detail !== 'production') return []
  const chains = new Set(
    [...scene.nodes.values()].filter((r) => r.node.kind === 'chain').map((r) => r.id),
  )
  // Where seats and their beads and claws are: within a stone's half-diagonal and a margin.
  const zones = scene.stones.map(({ stone }) => ({
    o: stone.frame.origin,
    r2: (Math.hypot(stone.dims.length, stone.dims.width, stone.dims.depth) / 2 + MIN_WALL_MM) ** 2,
  }))
  const nearStone = (x: number, y: number, z: number) =>
    zones.some(({ o, r2 }) => (x - o[0]) ** 2 + (y - o[1]) ** 2 + (z - o[2]) ** 2 < r2)

  const worst = new Map<string, { t: number; at: [number, number, number]; count: number }>()
  const bodies = new Map<Solid, string>()
  for (const { sources } of scene.parts)
    for (const { nodeId, body } of sources)
      if (!chains.has(nodeId) && body.solid.exact && !bodies.has(body.solid))
        bodies.set(body.solid, nodeId)
  for (const [solid, nodeId] of bodies) {
    const mesh = solid.triangles(scene.quality)
    const { positions: p, indices } = mesh
    const faces = indices.length / 3
    const cumulative = new Float64Array(faces)
    let area = 0
    for (let f = 0; f < faces; f++) {
      const a = indices[f * 3]! * 3
      const b = indices[f * 3 + 1]! * 3
      const c = indices[f * 3 + 2]! * 3
      const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!]
      const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!]
      area +=
        Math.hypot(
          u[1]! * v[2]! - u[2]! * v[1]!,
          u[2]! * v[0]! - u[0]! * v[2]!,
          u[0]! * v[1]! - u[1]! * v[0]!,
        ) / 2
      cumulative[f] = area
    }
    if (area <= 0) continue
    const tree = treeOf(mesh)
    const next = random(0x9e3779b9)
    const samples = Math.min(MAX_SAMPLES, Math.max(200, Math.round(area * DENSITY)))
    for (let s = 0; s < samples; s++) {
      // An area-weighted face, then a uniform point on it.
      const target = next() * area
      let lo = 0
      let hi = faces - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (cumulative[mid]! < target) lo = mid + 1
        else hi = mid
      }
      let r1 = next()
      let r2 = next()
      if (r1 + r2 > 1) {
        r1 = 1 - r1
        r2 = 1 - r2
      }
      const a = indices[lo * 3]! * 3
      const b = indices[lo * 3 + 1]! * 3
      const c = indices[lo * 3 + 2]! * 3
      const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!]
      const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!]
      const x = p[a]! + u[0]! * r1 + v[0]! * r2
      const y = p[a + 1]! + u[1]! * r1 + v[1]! * r2
      const z = p[a + 2]! + u[2]! * r1 + v[2]! * r2
      if (nearStone(x, y, z)) continue
      // Inward is against the outward normal of the fused (outward-wound) shell.
      const n = [
        u[1]! * v[2]! - u[2]! * v[1]!,
        u[2]! * v[0]! - u[0]! * v[2]!,
        u[0]! * v[1]! - u[1]! * v[0]!,
      ]
      const length = Math.hypot(n[0]!, n[1]!, n[2]!)
      if (length === 0) continue
      // The wall is where the ray first leaves the metal. Faces it enters on the way are folds
      // and creases beside the sample, not the far side of the wall (they read 0.01 mm).
      const exit = tree
        .crossings(x, y, z, -n[0]! / length, -n[1]! / length, -n[2]! / length)
        .find((hit) => hit.t > 1e-4 && hit.w < 0)
      const t = exit?.t ?? Infinity
      if (!(t < MIN_WALL_MM)) continue
      const entry = worst.get(nodeId)
      if (!entry) worst.set(nodeId, { t, at: [x, y, z], count: 1 })
      else {
        entry.count++
        if (t < entry.t) Object.assign(entry, { t, at: [x, y, z] })
      }
    }
  }
  return [...worst]
    .filter(([, w]) => w.count >= MIN_READINGS)
    .map(([nodeId, { t, at }]) => ({
      level: 'error' as const,
      code: 'wall.thin',
      nodeId,
      message: `“${scene.nodes.get(nodeId)?.node.name ?? nodeId}” has walls ${t.toFixed(2)} mm thin; metal under ${MIN_WALL_MM} mm does not fill in casting. Thicken it.`,
      at,
      value: t,
      limit: MIN_WALL_MM,
    }))
}
