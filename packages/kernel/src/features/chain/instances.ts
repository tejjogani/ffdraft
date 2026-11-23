/**
 * One body made of many copies of a few template parts — how a chain of hundreds of links stays
 * cheap. Each template is meshed once per quality and copied by matrix; the display mesh is
 * copied from the template's, so crease normals are computed once per template, not per link.
 * The exact B-rep (STEP only) is a compound of moved copies of each template's B-rep.
 */
import { type Shape3D, makeCompound } from 'replicad'
import {
  type IndexedTriangles,
  type Mat4,
  type Quality,
  type Solid,
  type SurfaceMesh,
  type Tessellation,
  lazySolid,
  QUALITY,
} from '../../core'
import {
  meshVolume,
  mergeTessellations,
  tessellationOf,
  transformTessellation,
  transformTriangles,
} from '../../solid/meshing'
import { transformShape } from '../../solid/occt'

export interface Template {
  /** Welded, watertight triangles at a quality. Must not capture WASM objects. */
  mesh(quality: Quality): IndexedTriangles
  /** The exact part; the caller deletes it. Omit for mesh-only parts. */
  brep?(): Shape3D
}

export interface Instance {
  template: number
  matrix: Mat4
}

/** Concatenates welded triangle sets (vertices are not shared between them). */
export function mergeTriangles(parts: readonly IndexedTriangles[]): IndexedTriangles {
  let vertices = 0
  let indices = 0
  for (const p of parts) {
    vertices += p.positions.length
    indices += p.indices.length
  }
  const positions = new Float32Array(vertices)
  const out = new Uint32Array(indices)
  let v = 0
  let i = 0
  for (const p of parts) {
    positions.set(p.positions, v)
    const base = v / 3
    for (let k = 0; k < p.indices.length; k++) out[i + k] = p.indices[k]! + base
    v += p.positions.length
    i += p.indices.length
  }
  return { positions, indices: out }
}

const qualityKey = (q: Quality) => `${q.chord}/${q.angle}`

export function instancedSolid(templates: readonly Template[], instances: readonly Instance[]): Solid {
  const cache = new Map<string, { tris: IndexedTriangles; display: Tessellation }[]>()
  const meshed = (quality: Quality) => {
    const key = qualityKey(quality)
    let entry = cache.get(key)
    if (!entry) {
      entry = templates.map((t) => {
        const tris = t.mesh(quality)
        return { tris, display: tessellationOf(tris) }
      })
      cache.set(key, entry)
    }
    return entry
  }
  const exact = templates.every((t) => t.brep)
  return lazySolid({
    mesh: (quality): SurfaceMesh => {
      const parts = meshed(quality)
      const placed = instances.map(({ template, matrix }) => ({ part: parts[template]!, matrix }))
      return {
        ...mergeTriangles(placed.map(({ part, matrix }) => transformTriangles(matrix, part.tris))),
        display: mergeTessellations(placed.map(({ part, matrix }) => transformTessellation(matrix, part.display))),
      }
    },
    volume: () => {
      const parts = meshed(QUALITY.production)
      return instances.reduce((sum, { template }) => sum + meshVolume(parts[template]!.tris), 0)
    },
    ...(exact && {
      brep: () => {
        const bases = templates.map((t) => t.brep!())
        const copies: Shape3D[] = []
        try {
          for (const { template, matrix } of instances) copies.push(transformShape(bases[template]!, matrix))
          return makeCompound(copies) as unknown as Shape3D
        } finally {
          for (const shape of [...bases, ...copies]) shape.delete()
        }
      },
    }),
  })
}
