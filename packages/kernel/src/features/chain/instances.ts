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
  /**
   * Meshed at the quality asked for and never coarsened to the budget: a part with one copy
   * (a clasp), which costs little and would lose its shape at a link's share of the triangles.
   */
  fixed?: boolean
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
 * Triangle caps for a whole instanced body. Draft: a 22" fine cable has ~600 links and a rope
 * several times that, and the viewport only needs them to read as links. Production: fine chain
 * is a visual and quote item that is normally bought, not cast (06-freeform.md §6), so it is
 * kept well under the 1 M triangles the strictest bureau accepts (02-production.md §2), leaving
 * room for the piece it hangs from.
 */
const BUDGET = { draft: 250_000, production: 750_000 } as const
/** Coarsening steps tried before a template is accepted as it is. */
const MAX_COARSENING = 8

const budgetFor = (quality: Quality) =>
  quality.chord < QUALITY.draft.chord ? BUDGET.production : BUDGET.draft

/** Re-meshes a template at coarser tolerances until one copy fits its share of the budget. */
function budgeted(template: Template, quality: Quality, share: number) {
  let q = quality
  let tris = template.mesh(q)
  let steps = 0
  for (; tris.indices.length / 3 > share && steps < MAX_COARSENING; steps++) {
    q = { chord: q.chord * 2, angle: Math.min(Math.PI / 2, q.angle * 1.4) }
    tris = template.mesh(q)
  }
  return { tris, reduced: steps > 0 }
}

export interface InstancedSolid {
  solid: Solid
  /** Whether the copies had to be meshed coarser than `quality` to stay within the budget. */
  reduced(quality: Quality): boolean
}

export function instancedSolid(
  templates: readonly Template[],
  instances: readonly Instance[],
): InstancedSolid {
  const cache = new Map<
    string,
    { tris: IndexedTriangles; display: Tessellation; reduced: boolean }[]
  >()
  const meshed = (quality: Quality) => {
    const key = qualityKey(quality)
    let entry = cache.get(key)
    if (!entry) {
      const copies = instances.filter((i) => !templates[i.template]!.fixed).length
      const share = budgetFor(quality) / Math.max(1, copies)
      entry = templates.map((t) => {
        const { tris, reduced } = t.fixed
          ? { tris: t.mesh(quality), reduced: false }
          : budgeted(t, quality, share)
        const display =
          t.crease === undefined
            ? tessellationOf(tris)
            : { mesh: creaseNormals(tris, t.crease), edges: featureEdges(tris, t.crease) }
        return { tris, display, reduced }
      })
      cache.set(key, entry)
    }
    return entry
  }
  const exact = templates.every((t) => t.brep)
  const solid = lazySolid({
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
    // From the full-detail template, not the budgeted copies: mass must not drop with detail.
    volume: () => {
      const each = templates.map((t) => meshVolume(t.mesh(QUALITY.production)))
      return instances.reduce((sum, { template }) => sum + each[template]!, 0)
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
  return { solid, reduced: (quality) => meshed(quality).some((t) => t.reduced) }
}
