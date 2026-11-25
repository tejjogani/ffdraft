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

/**
 * A coarse centreline pushed out at its bends so its straight runs touch the true curve instead
 * of cutting across inside it. Swept through few stations, a link's wire cut the inside of its
 * bends, where the next link passes: every pair of a long fine chain coarsened at draft
 * overlapped (curb 1 mm, 900 mm: 1091 of 1091 pairs), though production was clean. Each sample
 * moves away from its bend's centre by ρ(1/cos(φ/2) − 1), φ the turn there and ρ its radius,
 * which takes points on a circle to the polygon round it.
 */
function circumscribed(line: Centreline): Centreline {
  const { points, closed } = line
  const n = points.length / 3
  const out = new Float64Array(points)
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue
    const at = (k: number) => {
      const j = ((k % n) + n) % n
      return [points[j * 3]!, points[j * 3 + 1]!, points[j * 3 + 2]!] as const
    }
    const p = at(i)
    const a = at(i - 1)
    const b = at(i + 1)
    const u = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
    const v = [b[0] - p[0], b[1] - p[1], b[2] - p[2]]
    const lu = Math.hypot(u[0]!, u[1]!, u[2]!)
    const lv = Math.hypot(v[0]!, v[1]!, v[2]!)
    if (lu < 1e-12 || lv < 1e-12) continue
    const cos = (u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (lu * lv)
    const turn = Math.acos(Math.max(-1, Math.min(1, cos)))
    if (turn < 1e-6) continue
    // Toward the bend's centre: from p to the midpoint of its neighbours.
    const m = [(a[0] + b[0]) / 2 - p[0], (a[1] + b[1]) / 2 - p[1], (a[2] + b[2]) / 2 - p[2]]
    const lm = Math.hypot(m[0]!, m[1]!, m[2]!)
    if (lm < 1e-12) continue
    const radius = (lu + lv) / 2 / (2 * Math.sin(turn / 2))
    const push = radius * (1 / Math.cos(turn / 2) - 1)
    for (let k = 0; k < 3; k++) out[i * 3 + k] = p[k]! - (m[k]! / lm) * push
  }
  return { ...line, points: out }
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
  const sweep = (count: number) =>
    sweepAlong(
      count < stations ? circumscribed(link.centreline(count)) : link.centreline(count),
      link.profile,
    )
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
