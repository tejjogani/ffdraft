/**
 * Hole filling: each open boundary loop is capped with triangles that continue the surrounding
 * winding. Small, nearly planar holes (the usual scan or export gaps) are ear-clipped in their
 * best-fit plane; anything ear clipping cannot handle gets a fan around the loop's centroid,
 * which is always topologically valid.
 */
import { cross, dot, perpendicular, type Vec3 } from '../geometry/vec'
import type { IndexedTriangles } from '../solid/meshing'
import { boundaryLoops, edgeTopology } from './topology'

/** Ear clipping is O(n²); longer loops go straight to the fan. */
const MAX_EAR_LOOP = 2000

export function fillHoles(mesh: IndexedTriangles): { mesh: IndexedTriangles; holes: number } {
  const { twin } = edgeTopology(mesh)
  const loops = boundaryLoops(mesh, twin)
  if (loops.length === 0) return { mesh, holes: 0 }
  const positions = Array.from(mesh.positions)
  const indices = Array.from(mesh.indices)
  for (const loop of loops) {
    const ears = loop.length <= MAX_EAR_LOOP ? earClip(mesh.positions, loop) : null
    if (ears) indices.push(...ears)
    else {
      const c = positions.length / 3
      const centroid = [0, 0, 0]
      for (const v of loop)
        for (let k = 0; k < 3; k++) centroid[k]! += mesh.positions[v * 3 + k]! / loop.length
      positions.push(...centroid)
      for (let i = 0; i < loop.length; i++) indices.push(c, loop[i]!, loop[(i + 1) % loop.length]!)
    }
  }
  return {
    mesh: { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) },
    holes: loops.length,
  }
}

/** Triangles (flat index list) covering a loop, or null when it does not project to a simple polygon. */
function earClip(p: Float32Array, loop: readonly number[]): number[] | null {
  if (loop.length === 3) return [loop[0]!, loop[1]!, loop[2]!]
  // Newell normal: the loop runs counter-clockwise about it.
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]! * 3
    const b = loop[(i + 1) % loop.length]! * 3
    nx += (p[a + 1]! - p[b + 1]!) * (p[a + 2]! + p[b + 2]!)
    ny += (p[a + 2]! - p[b + 2]!) * (p[a]! + p[b]!)
    nz += (p[a]! - p[b]!) * (p[a + 1]! + p[b + 1]!)
  }
  const len = Math.hypot(nx, ny, nz)
  if (len === 0) return null
  // Project onto the plane: u, v span it, (u, v, n) right-handed.
  const n: Vec3 = [nx / len, ny / len, nz / len]
  const u = perpendicular(n)
  const v = cross(n, u)
  const xy = loop.map((i) => {
    const q: Vec3 = [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!]
    return [dot(q, u), dot(q, v)] as const
  })
  const area2 = (a: number, b: number, c: number) =>
    (xy[b]![0] - xy[a]![0]) * (xy[c]![1] - xy[a]![1]) -
    (xy[b]![1] - xy[a]![1]) * (xy[c]![0] - xy[a]![0])
  const remaining = loop.map((_, i) => i)
  const out: number[] = []
  let guard = 0
  while (remaining.length > 3) {
    if (guard++ > loop.length * loop.length) return null
    let clipped = false
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length]!
      const b = remaining[i]!
      const c = remaining[(i + 1) % remaining.length]!
      if (area2(a, b, c) <= 0) continue
      let blocked = false
      for (const o of remaining) {
        if (o === a || o === b || o === c) continue
        if (area2(a, b, o) >= 0 && area2(b, c, o) >= 0 && area2(c, a, o) >= 0) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      out.push(loop[a]!, loop[b]!, loop[c]!)
      remaining.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) return null
  }
  if (area2(remaining[0]!, remaining[1]!, remaining[2]!) <= 0) return null
  out.push(loop[remaining[0]!]!, loop[remaining[1]!]!, loop[remaining[2]!]!)
  return out
}
