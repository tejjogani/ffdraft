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
import { keepPieces } from '../pieces'
import type { OutlineDistance } from './distance'

export type EdgeStyle = 'flat' | 'chamfer' | 'round' | 'pillow'

export interface Profile {
  /** Front height (z) at a point (x, y) of the outline plane that lies δ inside the outline. */
  height(delta: number, x: number, y: number): number
  /** Distances at which slabs are cut, ascending from 0. */
  steps: number[]
  /** The face is not flat, so it is refined before lifting. */
  curved: boolean
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
 * Triangles a refined face may take: ~half a million in the whole body, a few seconds of work.
 * Beyond it the face is refined more coarsely instead of running out of time or memory.
 */
const MAX_FACE_TRIANGLES = 250_000
/** Shells below this volume (mm³) are collapsed steps and offset slivers, not the design. */
const DEBRIS = 1e-6

/**
 * The front profile of a body `thickness` thick (back at z = 0): `size` is the chamfer or
 * radius of the edge, or the rise of a pillow dome reaching full height `reach` mm inside.
 */
export function edgeProfile(
  style: EdgeStyle,
  size: number,
  thickness: number,
  reach: number,
): Profile {
  const b = Math.min(size, thickness * 0.9)
  if (style === 'flat' || b <= 1e-3) return flatProfile(thickness)
  if (style === 'chamfer')
    return { height: (d) => thickness - Math.max(0, b - d), steps: [0, b], curved: true }
  if (style === 'round') {
    // Quarter circle of radius b; steps evenly spaced along the arc.
    const steps = Array.from(
      { length: ROUND_STEPS + 1 },
      (_, k) => b * (1 - Math.cos((Math.PI / 2) * (k / ROUND_STEPS))),
    )
    return {
      height: (d) => {
        const t = Math.min(d, b)
        return thickness - (b - Math.sqrt(Math.max(0, b * b - (b - t) * (b - t))))
      },
      steps,
      curved: true,
    }
  }
  // Pillow: an elliptical dome h(δ) = rise·√(1 − (1 − δ/D)²) over the whole face, so the edge
  // rolls over vertically and the crest is flat; the slabs follow the arc evenly.
  const rise = Math.min(size, thickness - 0.3)
  const D = Math.max(reach, 1e-3)
  const steps = Array.from(
    { length: PILLOW_STEPS + 1 },
    (_, k) => D * 0.98 * (1 - Math.cos((Math.PI / 2) * (k / PILLOW_STEPS))),
  )
  return {
    height: (d) => {
      const t = Math.min(d / D, 1)
      return thickness - rise + rise * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))
    },
    steps,
    curved: true,
  }
}

export const flatProfile = (height: number): Profile => ({
  height: () => height,
  steps: [0],
  curved: false,
})

/**
 * A membrane dome for a field inside a raised border: the solution of ∇²u = −1 that vanishes
 * on the field's edge (the "membrane/Poisson" inflation of 06-freeform.md §3a). Unlike a
 * profile of the distance to the edge it has no ridge along the medial axis, every stroke of a
 * letter swells to suit its own width, and scaling it so that the strongest curvature (|∇²u|
 * across a strip) stays below 1/`minRadius` keeps a pavé field on it within the R/3 rule.
 */
export function membraneDome(
  field: OutlineDistance,
  bounds: { min: readonly [number, number]; max: readonly [number, number] },
  rise: number,
  floor: number,
  minRadius: number,
  spacing: number,
): Profile {
  const x0 = bounds.min[0] - spacing
  const y0 = bounds.min[1] - spacing
  const nx = Math.ceil((bounds.max[0] - x0) / spacing) + 2
  const ny = Math.ceil((bounds.max[1] - y0) / spacing) + 2
  const inside = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      inside[j * nx + i] = field.inside(x0 + i * spacing, y0 + j * spacing) ? 1 : 0
  // Successive over-relaxation with the optimal factor for an n-wide grid. The slowest mode of
  // the membrane spans the field's narrow side, so a long strip converges as fast as its width.
  const u = new Float64Array(nx * ny)
  const n = Math.min(nx, ny)
  const omega = 2 / (1 + Math.sin(Math.PI / n))
  const h2 = spacing * spacing
  for (let iter = 0; iter < 6 * n; iter++) {
    let change = 0
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i
        if (!inside[k]) continue
        const next = (u[k - 1]! + u[k + 1]! + u[k - nx]! + u[k + nx]! + h2) / 4
        const delta = omega * (next - u[k]!)
        u[k] = u[k]! + delta
        change = Math.max(change, Math.abs(delta))
      }
    if (change < 1e-7 * h2) break
  }
  let peak = 0
  for (const v of u) peak = Math.max(peak, v)
  const s = peak > 0 ? Math.min(rise / peak, 1 / minRadius) : 0
  if (s * peak <= 1e-3) return flatProfile(floor)
  const sample = (x: number, y: number): number => {
    const fx = Math.min(Math.max((x - x0) / spacing, 0), nx - 1.001)
    const fy = Math.min(Math.max((y - y0) / spacing, 0), ny - 1.001)
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const tx = fx - i
    const ty = fy - j
    const k = j * nx + i
    return (
      (u[k]! * (1 - tx) + u[k + 1]! * tx) * (1 - ty) +
      (u[k + nx]! * (1 - tx) + u[k + nx + 1]! * tx) * ty
    )
  }
  return { height: (_d, x, y) => floor - s * peak + s * sample(x, y), steps: [0], curved: true }
}

export interface SlabOptions {
  /** The full outline (distances are measured to it). */
  outline: CrossSection
  distance: OutlineDistance
  profile: Profile
  /** Keep only this part of every slab (e.g. the rim outside a field), if given. */
  within?: (slab: CrossSection) => CrossSection
  /** Only steps below this distance are used, and distances are clamped to it. */
  to?: number
  /** Segments per full circle for round offset joins. */
  segments: number
  /** Longest edge on a profiled face, mm. */
  resolution: number
}

/** The profiled slab, back on z = 0, front up +z. The caller owns the result. */
export function profiledSlab(o: SlabOptions): Manifold {
  const { manifold: mf } = runtime()
  const to = o.to ?? Infinity
  const deltas = o.profile.steps.filter((d) => d === 0 || d < to)
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
      const { min } = section.bounds()
      const extruded = section.extrude(o.profile.height(delta, min[0], min[1]) - base)
      owned.push(extruded)
      const slab = base > 0 ? extruded.translate([0, 0, base]) : extruded
      if (slab !== extruded) owned.push(slab)
      slabs.push(slab)
    }
    if (slabs.length === 0) throw new Error('The outline is too small for its edge profile')
    let stacked = slabs.length === 1 ? slabs[0]!.translate([0, 0, 0]) : mf.Manifold.union(slabs)
    owned.push(stacked)
    if (o.profile.curved) {
      // Treads are triangulated from their two contours only, which leaves long slivers across
      // the medial axis; refining first lets every point of the face follow the true profile.
      // An equilateral mesh of edge e holds about 2.3 / e² triangles per mm².
      const area = o.outline.area()
      stacked = stacked.refineToLength(
        Math.max(o.resolution, Math.sqrt((2.3 * area) / MAX_FACE_TRIANGLES)),
      )
      owned.push(stacked)
    }
    const lifted = stacked.warpBatch((verts, count) => {
      for (let i = 0; i < count; i++) {
        // Back-plane vertices stay; every front vertex takes the height of its own distance.
        if (verts[i * 3 + 2]! <= 1e-9) continue
        const x = verts[i * 3]!
        const y = verts[i * 3 + 1]!
        verts[i * 3 + 2] = o.profile.height(Math.min(to, o.distance.distance(x, y)), x, y)
      }
    })
    owned.push(lifted)
    // The collapsed steps leave zero-area slivers; collapsing sub-micron edges removes them.
    // Where an offset contour, thinned on its own, pokes past the one outside it, its slab's
    // walls fold into zero-volume shells when lifted; those are dropped.
    return keepPieces(lifted.simplify(COLLAPSE), (volume) => volume > DEBRIS)
  } finally {
    for (const x of owned) x.delete()
  }
}
