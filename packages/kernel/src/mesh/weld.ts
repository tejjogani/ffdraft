/**
 * Tolerance welding and clean-up of triangle soups. File formats store triangles separately
 * (STL) or with float noise along seams; welding within a small tolerance turns that soup into
 * a connected surface. (`solid/meshing.weld` merges only bit-identical coordinates, which is
 * right for B-rep tessellations but not for imports.)
 */
import type { IndexedTriangles } from '../solid/meshing'
import { PointGrid } from './grid'

/** Merges vertices closer than `tolerance` (first come, first kept) and drops collapsed triangles. */
export function weldWithin(mesh: IndexedTriangles, tolerance: number): IndexedTriangles {
  const { positions, indices } = mesh
  const count = positions.length / 3
  const grid = new PointGrid(Math.max(tolerance, 1e-12) * 2)
  const remap = new Uint32Array(count)
  const unique = new Float32Array(positions.length)
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]!
    const y = positions[i * 3 + 1]!
    const z = positions[i * 3 + 2]!
    const found = grid.nearest(x, y, z, tolerance)
    if (found >= 0) remap[i] = found
    else {
      const r = grid.add(x, y, z)
      unique.set(positions.subarray(i * 3, i * 3 + 3), r * 3)
      remap[i] = r
    }
  }
  return cleanTriangles({
    positions: unique.slice(0, grid.size * 3),
    indices: reindex(indices, remap),
  })
}

function reindex(indices: Uint32Array, remap: Uint32Array): Uint32Array {
  const out = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i++) out[i] = remap[indices[i]!]!
  return out
}

/**
 * Removes triangles that repeat a vertex, have zero area, or duplicate another triangle. A pair
 * of opposite-facing duplicates is an internal wall and is removed entirely.
 */
export function cleanTriangles({ positions: p, indices }: IndexedTriangles): IndexedTriangles {
  const kept: number[] = []
  const seen = new Map<string, number>()
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!
    const b = indices[t + 1]!
    const c = indices[t + 2]!
    if (a === b || b === c || c === a) continue
    const ux = p[b * 3]! - p[a * 3]!
    const uy = p[b * 3 + 1]! - p[a * 3 + 1]!
    const uz = p[b * 3 + 2]! - p[a * 3 + 2]!
    const vx = p[c * 3]! - p[a * 3]!
    const vy = p[c * 3 + 1]! - p[a * 3 + 1]!
    const vz = p[c * 3 + 2]! - p[a * 3 + 2]!
    const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
    if (area2 === 0) continue
    const sorted = [a, b, c].sort((x, y) => x - y)
    const key = sorted.join(',')
    const previous = seen.get(key)
    if (previous !== undefined) {
      // Same winding: a plain duplicate. Opposite winding: an internal face pair, drop both.
      if (previous >= 0 && !sameWinding(kept, previous, a, b, c)) {
        kept.splice(previous, 3, -1, -1, -1)
        seen.set(key, -1)
      }
      continue
    }
    seen.set(key, kept.length)
    kept.push(a, b, c)
  }
  const out = kept.filter((v) => v >= 0)
  return compact(p, Uint32Array.from(out))
}

/** True when (a, b, c) is a cyclic rotation of the kept triangle at `at`. */
function sameWinding(kept: number[], at: number, a: number, b: number, c: number): boolean {
  const x = kept[at]!
  const y = kept[at + 1]!
  const z = kept[at + 2]!
  return (
    (x === a && y === b && z === c) ||
    (y === a && z === b && x === c) ||
    (z === a && x === b && y === c)
  )
}

/** Drops vertices no triangle references. */
export function compact(positions: Float32Array, indices: Uint32Array): IndexedTriangles {
  const count = positions.length / 3
  const map = new Int32Array(count).fill(-1)
  let n = 0
  for (const v of indices) if (map[v]! < 0) map[v] = n++
  const out = new Float32Array(n * 3)
  for (let v = 0; v < count; v++) {
    const m = map[v]!
    if (m >= 0) out.set(positions.subarray(v * 3, v * 3 + 3), m * 3)
  }
  const remapped = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i++) remapped[i] = map[indices[i]!]!
  return { positions: out, indices: remapped }
}
