/**
 * A wire link as an instancing template: its section swept along its centreline (exact B-rep
 * and analytic mesh, centreline.ts), with the faces ground flat for diamond-cut styles.
 */
import { makeBox, type Shape3D } from 'replicad'
import { type IndexedTriangles, QUALITY, type Quality } from '../../core'
import type { Loop } from '../../geometry/loop'
import { booleanShapes } from '../../solid/occt'
import { manifoldFromTriangles, trianglesFromManifold } from '../../solid/solid'
import { type Centreline, sweepAlong } from './centreline'
import type { Template } from './instances'

export interface WireLink {
  /** The centreline at `count` samples. */
  centreline(count: number): Centreline
  /** The wire's section, drawn as (side, up). */
  profile: Loop
  /** Radius of the circle around the section, for clearance tests. */
  radius: number
  /** Faces ground flat to |z| ≤ flat — the diamond cut of curb and Cuban chain. */
  flat?: number
}

/**
 * Wire links read as smooth round wire down to 8 facets around (45° apart) while the Cuban's
 * diamond-cut flats, which meet the wire at ~66°, keep their crisp edge.
 */
const LINK_CREASE = (52 * Math.PI) / 180

/** Grinds a wire link's faces flat at |z| = flat (the diamond cut), on its mesh. */
function grindMesh(tris: IndexedTriangles, flat: number): IndexedTriangles {
  const wire = manifoldFromTriangles(tris)
  const below = wire.trimByPlane([0, 0, -1], -flat)
  const ground = below.trimByPlane([0, 0, 1], -flat)
  try {
    return trianglesFromManifold(ground)
  } finally {
    for (const m of [wire, below, ground]) m.delete()
  }
}

/** …and on its exact B-rep. */
function grindBrep(shape: Shape3D, flat: number): Shape3D {
  const slab = makeBox([-1e3, -1e3, -flat], [1e3, 1e3, flat])
  try {
    return booleanShapes('intersect', shape, [slab])
  } finally {
    slab.delete()
  }
}

/** Fewest sweep stations a link is meshed with when a long fine chain is coarsened to budget. */
const MIN_STATIONS = 8

/**
 * The template for a wire link swept through `stations` centreline samples (fewer on meshes
 * coarser than draft, which is how instances.ts fits hundreds of fine links in its budget).
 * The sweep is rebuilt inside each recipe call: it is cheap, and keeps the recipe free of
 * WASM objects.
 */
export function wireTemplate(link: WireLink, stations: number): Template {
  const sweep = (count: number) => sweepAlong(link.centreline(count), link.profile)
  return {
    crease: LINK_CREASE,
    mesh(quality: Quality) {
      const coarsening = Math.sqrt(QUALITY.draft.chord / quality.chord)
      const solid = sweep(
        Math.max(MIN_STATIONS, Math.min(stations, Math.round(stations * coarsening))),
      )
      try {
        const tris = solid.triangles(quality)
        return link.flat === undefined ? tris : grindMesh(tris, link.flat)
      } finally {
        solid.dispose()
      }
    },
    brep() {
      const solid = sweep(stations)
      try {
        const shape = solid.brep()!
        return link.flat === undefined ? shape.clone() : grindBrep(shape, link.flat)
      } finally {
        solid.dispose()
      }
    },
  }
}
