/** Wavefront OBJ: `v` and `f` records (any polygon size, negative indices, v/vt/vn tokens). */
import type { IndexedTriangles } from '../../solid/meshing'
import { decodeText, fan, lines } from './text'

export const looksLikeObj = (head: string): boolean =>
  /^(v|vn|vt|f|o|g|mtllib|#)\s/m.test(head) && /^v\s/m.test(head)

export function parseObj(bytes: Uint8Array): IndexedTriangles {
  const positions: number[] = []
  const indices: number[] = []
  const polygon: number[] = []
  for (const raw of lines(decodeText(bytes))) {
    const line = raw.trim()
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/)
      positions.push(Number(x), Number(y), Number(z))
    } else if (line.startsWith('f ')) {
      polygon.length = 0
      const count = positions.length / 3
      for (const token of line.split(/\s+/).slice(1)) {
        const i = Number.parseInt(token, 10)
        if (!Number.isFinite(i) || i === 0)
          throw new Error(`The OBJ file has an invalid face index “${token}”`)
        const v = i > 0 ? i - 1 : count + i
        if (v < 0 || v >= count)
          throw new Error(`The OBJ file refers to vertex ${i}, which is not defined`)
        polygon.push(v)
      }
      fan(polygon, indices)
    }
  }
  if (positions.some((v) => !Number.isFinite(v)))
    throw new Error('The OBJ file has non-numeric vertex coordinates')
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
