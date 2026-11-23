/**
 * Profiled extrusion of a 2D outline: the front face rises as a function of the distance δ to
 * the outline — a chamfer, a rounded edge, or a pillow dome over the whole face
 * (docs/research/06-freeform.md §3a: "bevel and puffy via an inside distance transform with a
 * height profile, meshed as heightfield + walls + flat back").
 *
 * Construction: one slab per inward offset of the outline (Clipper round joins, so each offset
 * is exactly the iso-line δ = δₖ), unioned by Manifold — which settles every change of topology
 * as strokes thin out — then every front vertex is lifted to the profile height of its own
 * distance to the outline. The steps between slabs collapse and the treads between offsets
 * become the sloped surface: a watertight loft whatever the outline's shape.
 */
import type { CrossSection, Manifold } from 'manifold-3d'
import { runtime } from '../../runtime/index'
import type { OutlineDistance } from './distance'

export type EdgeStyle = 'flat' | 'chamfer' | 'round' | 'pillow'

export interface Profile {
  /** Front height (z) at distance δ inside the outline. */
  height(delta: number): number
  /** Distances at which slabs are cut, ascending from 0. */
  steps: number[]
}

/**
 * Slab counts. The face is refined and every vertex lifted to its exact height afterwards, so
 * slabs only need to pin the steep zone near the edge and the places where strokes run out.
 */
const ROUND_STEPS = 6
const PILLOW_STEPS = 8
/** Offset contours are thinned to this deviation (mm) before extrusion; booleans scale with vertices. */
const CONTOUR_TOLERANCE = 0.002
/** Vertical offset between the bases of successive slabs, mm. */
const STACK_STEP = 0.01
/** Edges shorter than this (mm) are collapsed after lifting. */
const COLLAPSE = 1e-3

/**
 * The front profile of a body `thickness` thick (back at z = 0): `size` is the chamfer or
 * radius of the edge, or the rise of a pillow dome reaching full height `reach` mm inside.
 */
export function edgeProfile(style: EdgeStyle, size: number, thickness: number, reach: number): Profile {
  const b = Math.min(size, thickness * 0.9)
  if (style === 'flat' || b <= 1e-3) return { height: () => thickness, steps: [0] }
  if (style === 'chamfer') return { height: (d) => thickness - Math.max(0, b - d), steps: [0, b] }
  if (style === 'round') {
    // Quarter circle of radius b; steps evenly spaced along the arc.
    const steps = Array.from({ length: ROUND_STEPS + 1 }, (_, k) => b * (1 - Math.cos((Math.PI / 2) * (k / ROUND_STEPS))))
    return {
      height: (d) => {
        const t = Math.min(d, b)
        return thickness - (b - Math.sqrt(Math.max(0, b * b - (b - t) * (b - t))))
      },
      steps,
    }
  }
  // Pillow: an elliptical dome h(δ) = rise·√(1 − (1 − δ/D)²) over the whole face, so the edge
  // rolls over vertically and the crest is flat; the slabs follow the arc evenly.
  const rise = Math.min(size, thickness - 0.3)
  const D = Math.max(reach, 1e-3)
  const steps = Array.from({ length: PILLOW_STEPS + 1 }, (_, k) => D * 0.98 * (1 - Math.cos((Math.PI / 2) * (k / PILLOW_STEPS))))
  return {
    height: (d) => {
      const t = Math.min(d / D, 1)
      return thickness - rise + rise * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))
    },
    steps,
  }
}

export interface SlabOptions {
  /** The full outline (distances are measured to it). */
  outline: CrossSection
  distance: OutlineDistance
  profile: Profile
  /** Keep only this part of every slab (e.g. the rim outside a field), if given. */
  within?: (slab: CrossSection) => CrossSection
  /** Only steps in [from, to] are used and distances are clamped to it. */
  from?: number
  to?: number
  /** Lowers the whole front by this much (a recessed field). */
  drop?: number
  /** Segments per full circle for round offset joins. */
  segments: number
  /** Longest edge on a profiled face, mm. */
  resolution: number
}

/** The profiled slab, back on z = 0, front up +z. The caller owns the result. */
export function profiledSlab(o: SlabOptions): Manifold {
  const { manifold: mf } = runtime()
  const from = o.from ?? 0
  const to = o.to ?? Infinity
  const drop = o.drop ?? 0
  const deltas = [...new Set([from, ...o.profile.steps.filter((d) => d > from && d < to)])]
  const owned: { delete(): void }[] = []
  try {
    const slabs: Manifold[] = []
    for (const delta of deltas) {
      let section = o.outline
      if (delta > 0) {
        const offset = o.outline.offset(-delta, 'Round', 2, o.segments)
        owned.push(offset)
        section = offset.simplify(CONTOUR_TOLERANCE)
        owned.push(section)
      }
      if (o.within) {
        section = o.within(section)
        owned.push(section)
      }
      if (section.isEmpty()) continue
      // Each slab starts a little higher than the one before, inside it: coplanar overlapping
      // faces are the slow case for mesh booleans, and the inner bottoms vanish in the union.
      const base = slabs.length * STACK_STEP
      const extruded = section.extrude(o.profile.height(delta) - drop - base)
      owned.push(extruded)
      const slab = base > 0 ? extruded.translate([0, 0, base]) : extruded
      if (slab !== extruded) owned.push(slab)
      slabs.push(slab)
    }
    if (slabs.length === 0) throw new Error('The outline is too small for its edge profile')
    let stacked = slabs.length === 1 ? slabs[0]!.translate([0, 0, 0]) : mf.Manifold.union(slabs)
    owned.push(stacked)
    if (slabs.length > 1) {
      // Treads are triangulated from their two contours only, which leaves long slivers across
      // the medial axis; refining first lets every point of the face follow the true profile.
      stacked = stacked.refineToLength(o.resolution)
      owned.push(stacked)
    }
    const lifted = stacked.warpBatch((verts, count) => {
      for (let i = 0; i < count; i++) {
        // Back-plane vertices stay; every front vertex takes the height of its own distance.
        if (verts[i * 3 + 2]! <= 1e-9) continue
        const d = Math.min(to, Math.max(from, o.distance.distance(verts[i * 3]!, verts[i * 3 + 1]!)))
        verts[i * 3 + 2] = o.profile.height(d) - drop
      }
    })
    owned.push(lifted)
    // The collapsed steps leave zero-area slivers; collapsing sub-micron edges removes them.
    return lifted.simplify(COLLAPSE)
  } finally {
    for (const x of owned) x.delete()
  }
}
