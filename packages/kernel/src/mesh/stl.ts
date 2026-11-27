import type { IndexedTriangles } from '../solid/meshing'

const HEADER_BYTES = 80
const TRIANGLE_BYTES = 50

/** Writes triangles with facet normals from their winding (STL readers ignore stored ones anyway). */
export function writeStl(
  objects: readonly IndexedTriangles[],
  header: string,
): Uint8Array<ArrayBuffer> {
  const count = objects.reduce((n, o) => n + o.indices.length / 3, 0)
  const bytes = new Uint8Array(HEADER_BYTES + 4 + count * TRIANGLE_BYTES)
  bytes.set(new TextEncoder().encode(header.slice(0, HEADER_BYTES)))
  const view = new DataView(bytes.buffer)
  view.setUint32(HEADER_BYTES, count, true)
  let at = HEADER_BYTES + 4
  for (const { positions: p, indices } of objects)
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t]! * 3
      const b = indices[t + 1]! * 3
      const c = indices[t + 2]! * 3
      const ux = p[b]! - p[a]!
      const uy = p[b + 1]! - p[a + 1]!
      const uz = p[b + 2]! - p[a + 2]!
      const vx = p[c]! - p[a]!
      const vy = p[c + 1]! - p[a + 1]!
      const vz = p[c + 2]! - p[a + 2]!
      let nx = uy * vz - uz * vy
      let ny = uz * vx - ux * vz
      let nz = ux * vy - uy * vx
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l
      ny /= l
      nz /= l
      for (const v of [
        nx,
        ny,
        nz,
        p[a]!,
        p[a + 1]!,
        p[a + 2]!,
        p[b]!,
        p[b + 1]!,
        p[b + 2]!,
        p[c]!,
        p[c + 1]!,
        p[c + 2]!,
      ]) {
        view.setFloat32(at, v, true)
        at += 4
      }
      at += 2 // attribute byte count
    }
  return bytes
}
