/**
 * A 57-facet round brilliant in the kernel's unit-gem convention (girdle width 1, table +Z,
 * girdle plane z = 0), for tests and the demo only — the kernel owns production gem geometry.
 *
 * Facet planes are constructed so every kite is exactly planar: each bezel (pavilion main)
 * plane contains its girdle main point, its table corner (culet) and the tangent there; star
 * and lower-girdle tips sit on the intersection of neighbouring planes.
 */
import type { MeshData } from '@pave/kernel/types'
import { GEM_CUTS } from '@pave/schema'

type P = [number, number, number]

const STAR_LENGTH = 0.5
const LOWER_GIRDLE_LENGTH = 0.77

export function roundBrilliant(): MeshData {
  const { tablePct, crownPct, pavilionPct, girdlePct } = GEM_CUTS.round
  const R = 0.5
  const t = tablePct / 2
  const zg = girdlePct / 2
  const zt = zg + crownPct
  const zc = -zg - pavilionPct
  const at = (k: number) => (k * Math.PI) / 4
  const polar = (a: number, r: number, z: number): P => [r * Math.cos(a), r * Math.sin(a), z]
  const c = Math.cos(Math.PI / 8)

  const T = Array.from({ length: 8 }, (_, k) => polar(at(k), t, zt))
  const G = Array.from({ length: 8 }, (_, k) => polar(at(k), R, zg))
  const H = Array.from({ length: 8 }, (_, k) => polar(at(k) + Math.PI / 8, R, zg))
  const Gb = G.map(([x, y]) => [x, y, -zg] as P)
  const Hb = H.map(([x, y]) => [x, y, -zg] as P)
  // Star tip: on bezel plane k at horizontal radius ρ along the bisector.
  const rs = t + STAR_LENGTH * (R - t)
  const S = Array.from({ length: 8 }, (_, k) => {
    const r = rs / c
    return polar(at(k) + Math.PI / 8, r, zg + ((R - r * c) * (zt - zg)) / (R - t))
  })
  const rp = R * (1 - LOWER_GIRDLE_LENGTH)
  const Pv = Array.from({ length: 8 }, (_, k) =>
    polar(at(k) + Math.PI / 8, rp / c, zc + (rp * (-zg - zc)) / R),
  )
  const culet: P = [0, 0, zc]

  const faces: P[][] = [T]
  const n = (k: number) => (k + 8) % 8
  for (let k = 0; k < 8; k++) {
    faces.push([T[k]!, T[n(k + 1)]!, S[k]!]) // star
    faces.push([T[k]!, S[n(k - 1)]!, G[k]!, S[k]!]) // bezel
    faces.push([S[k]!, G[k]!, H[k]!], [S[k]!, H[k]!, G[n(k + 1)]!]) // upper girdle
    faces.push([G[k]!, H[k]!, Hb[k]!, Gb[k]!], [H[k]!, G[n(k + 1)]!, Gb[n(k + 1)]!, Hb[k]!]) // girdle
    faces.push([culet, Pv[n(k - 1)]!, Gb[k]!, Pv[k]!]) // pavilion main
    faces.push([Pv[k]!, Gb[k]!, Hb[k]!], [Pv[k]!, Hb[k]!, Gb[n(k + 1)]!]) // lower girdle
  }
  return facetedMesh(faces)
}

/** Flat-shaded mesh from convex polygons around the origin, wound outward. */
export function facetedMesh(faces: P[][]): MeshData {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (const face of faces) {
    const [a, b, cc] = face as [P, P, P]
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]]
    let nx = u[1]! * v[2]! - u[2]! * v[1]!
    let ny = u[2]! * v[0]! - u[0]! * v[2]!
    let nz = u[0]! * v[1]! - u[1]! * v[0]!
    const centroid = face.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
    const outward = nx * centroid[0] + ny * centroid[1] + nz * centroid[2] >= 0
    const len = Math.hypot(nx, ny, nz) * (outward ? 1 : -1)
    nx /= len
    ny /= len
    nz /= len
    const ordered = outward ? face : [...face].reverse()
    const base = positions.length / 3
    for (const p of ordered) {
      positions.push(...p)
      normals.push(nx, ny, nz)
    }
    for (let i = 1; i < ordered.length - 1; i++) indices.push(base, base + i, base + i + 1)
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  }
}
