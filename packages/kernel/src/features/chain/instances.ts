/**
 * One body made of many copies of a few template parts — how a chain of hundreds of links stays
 * cheap. Each template is meshed once per quality and copied by matrix; the display mesh is
 * copied from the template's, so crease normals are computed once per template, not per link.
 * The exact B-rep (STEP only) is a compound of moved copies of each template's B-rep.
 */
import { makeCompound, type Shape3D } from 'replicad'
import {
  type IndexedTriangles,
  lazySolid,
  type Mat4,
  QUALITY,
  type Quality,
  type Solid,
  type SurfaceMesh,
  type Tessellation,
} from '../../core'
import {
  creaseNormals,
  featureEdges,
  mergeTessellations,
  meshVolume,
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
  /** Dihedral angle above which the display mesh shows a hard edge (default: the kernel's). */
  crease?: number
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

/**
 * A draft chain is capped at about this many triangles: a 22" fine cable has ~600 links and a
 * rope twice that, and the viewport only needs them to read as links. Each template is re-meshed
 * at a coarser tolerance until one copy fits its per-copy share.
 */
const DRAFT_TRIANGLES = 250_000
/** Never coarser than this facet angle: hexagonal wire at worst. */
const COARSEST_ANGLE = Math.PI / 3

function budgeted(template: Template, quality: Quality, share: number): IndexedTriangles {
  let q = quality
  let tris = template.mesh(q)
  if (quality.chord < QUALITY.draft.chord) return tris
  while (tris.indices.length / 3 > share && q.angle < COARSEST_ANGLE) {
    q = { chord: q.chord * 2, angle: Math.min(COARSEST_ANGLE, q.angle * 1.4) }
    tris = template.mesh(q)
  }
  return tris
}

export function instancedSolid(
  templates: readonly Template[],
  instances: readonly Instance[],
): Solid {
  const cache = new Map<string, { tris: IndexedTriangles; display: Tessellation }[]>()
  const meshed = (quality: Quality) => {
    const key = qualityKey(quality)
    let entry = cache.get(key)
    if (!entry) {
      entry = templates.map((t) => {
        const tris = budgeted(t, quality, DRAFT_TRIANGLES / instances.length)
        const display =
          t.crease === undefined
            ? tessellationOf(tris)
            : { mesh: creaseNormals(tris, t.crease), edges: featureEdges(tris, t.crease) }
        return { tris, display }
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
        display: mergeTessellations(
          placed.map(({ part, matrix }) => transformTessellation(matrix, part.display)),
        ),
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
          for (const { template, matrix } of instances)
            copies.push(transformShape(bases[template]!, matrix))
          return makeCompound(copies) as unknown as Shape3D
        } finally {
          for (const shape of [...bases, ...copies]) shape.delete()
        }
      },
    }),
  })
}
