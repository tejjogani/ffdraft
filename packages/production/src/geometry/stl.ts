/** Binary STL (little-endian, mm — STL carries no units, so the manifest states them). */
import type { Tris } from './mesh'

export function writeBinaryStl(mesh: Tris, header: string): Uint8Array {
  const faces = mesh.indices.length / 3
  const out = new Uint8Array(84 + faces * 50)
  const view = new DataView(out.buffer)
  const head = new TextEncoder().encode(header.slice(0, 80))
  out.set(head.subarray(0, 80), 0)
  view.setUint32(80, faces, true)
  const p = mesh.positions
  let o = 84
  for (let f = 0; f < faces; f++) {
    const a = mesh.indices[f * 3]! * 3
    const b = mesh.indices[f * 3 + 1]! * 3
    const c = mesh.indices[f * 3 + 2]! * 3
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
    view.setFloat32(o, nx, true)
    view.setFloat32(o + 4, ny, true)
    view.setFloat32(o + 8, nz, true)
    for (const v of [a, b, c]) {
      o += 12
      view.setFloat32(o, p[v]!, true)
      view.setFloat32(o + 4, p[v + 1]!, true)
      view.setFloat32(o + 8, p[v + 2]!, true)
    }
    o += 14
  }
  return out
}

/** Reads a binary STL into an unwelded triangle soup; null when the bytes are not binary STL. */
export function readBinaryStl(bytes: Uint8Array): Tris | null {
  if (bytes.length < 84) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const faces = view.getUint32(80, true)
  if (84 + faces * 50 !== bytes.length) return null
  const positions = new Float32Array(faces * 9)
  const indices = new Uint32Array(faces * 3)
  for (let f = 0; f < faces; f++) {
    const o = 84 + f * 50 + 12
    for (let k = 0; k < 9; k++) positions[f * 9 + k] = view.getFloat32(o + k * 4, true)
    indices[f * 3] = f * 3
    indices[f * 3 + 1] = f * 3 + 1
    indices[f * 3 + 2] = f * 3 + 2
  }
  return { positions, indices }
}
