/**
 * Wall thickness by inward ray casting: area-weighted surface samples shoot a ray along the
 * inward normal and the distance to the first surface hit is the local wall. Samples are drawn
 * from a fixed-seed generator, so the report is reproducible. This is the method of the common
 * 3D-print checkers; it over-reads oblique walls slightly, which errs toward fewer false alarms.
 */
import type { TriangleBVH } from '../geometry/bvh'
import type { Tris } from '../geometry/mesh'

export interface ThinRegion {
  /** Thinnest reading in the region, mm. */
  thicknessMm: number
  /** Where that reading starts (on the surface), mm. */
  at: [number, number, number]
  /** How many samples in the region read below the threshold. */
  samples: number
}

export interface ThicknessReport {
  samples: number
  /** Samples skipped by `exclude` (e.g. inside pavé seat zones). */
  excluded: number
  minMm: number
  /** Median reading, mm: a sense of the typical wall. */
  medianMm: number
  /** Share of samples below `threshold`. */
  thinFraction: number
  regions: ThinRegion[]
}

export interface ThicknessOptions {
  threshold: number
  /** Samples per mm² of surface, capped by `maxSamples`. */
  density?: number
  maxSamples?: number
  /** Samples within this distance merge into one region. */
  regionRadius?: number
  maxRegions?: number
  /** Skip samples here: zones another rule governs (pavé seats and beads). */
  exclude?: (x: number, y: number, z: number) => boolean
}

/** mulberry32: tiny, fast, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function wallThickness(
  mesh: Tris,
  bvh: TriangleBVH,
  opts: ThicknessOptions,
): ThicknessReport {
  const p = mesh.positions
  const idx = mesh.indices
  const faces = idx.length / 3
  const cum = new Float64Array(faces)
  const normals = new Float32Array(faces * 3)
  let area = 0
  let signedVolume = 0
  for (let f = 0; f < faces; f++) {
    const a = idx[f * 3]! * 3
    const b = idx[f * 3 + 1]! * 3
    const c = idx[f * 3 + 2]! * 3
    const ux = p[b]! - p[a]!
    const uy = p[b + 1]! - p[a + 1]!
    const uz = p[b + 2]! - p[a + 2]!
    const vx = p[c]! - p[a]!
    const vy = p[c + 1]! - p[a + 1]!
    const vz = p[c + 2]! - p[a + 2]!
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz)
    area += l / 2
    cum[f] = area
    if (l > 0) {
      normals[f * 3] = nx / l
      normals[f * 3 + 1] = ny / l
      normals[f * 3 + 2] = nz / l
    }
    signedVolume += (p[a]! * nx + p[a + 1]! * ny + p[a + 2]! * nz) / 6
  }
  // Inward is −n for an outward-wound mesh; flip if the mesh is wound inside out.
  const inward = signedVolume >= 0 ? -1 : 1
  const n = Math.min(
    opts.maxSamples ?? 20_000,
    Math.max(200, Math.round(area * (opts.density ?? 8))),
  )
  const rand = rng(0x9e3779b9)
  const readings: { t: number; at: [number, number, number] }[] = []
  let excluded = 0
  for (let s = 0; s < n && area > 0; s++) {
    const target = rand() * area
    let lo = 0
    let hi = faces - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid]! < target) lo = mid + 1
      else hi = mid
    }
    const f = lo
    let r1 = rand()
    let r2 = rand()
    if (r1 + r2 > 1) {
      r1 = 1 - r1
      r2 = 1 - r2
    }
    const a = idx[f * 3]! * 3
    const b = idx[f * 3 + 1]! * 3
    const c = idx[f * 3 + 2]! * 3
    const x = p[a]! + (p[b]! - p[a]!) * r1 + (p[c]! - p[a]!) * r2
    const y = p[a + 1]! + (p[b + 1]! - p[a + 1]!) * r1 + (p[c + 1]! - p[a + 1]!) * r2
    const z = p[a + 2]! + (p[b + 2]! - p[a + 2]!) * r1 + (p[c + 2]! - p[a + 2]!) * r2
    if (opts.exclude?.(x, y, z)) {
      excluded++
      continue
    }
    const dx = normals[f * 3]! * inward
    const dy = normals[f * 3 + 1]! * inward
    const dz = normals[f * 3 + 2]! * inward
    if (dx === 0 && dy === 0 && dz === 0) continue
    // A reading must leave the metal: the struck face points along the ray. Entering hits come
    // from folds and creases next to the sample, not from the opposite wall.
    const exits = (tri: number) =>
      tri !== f &&
      (normals[tri * 3]! * dx + normals[tri * 3 + 1]! * dy + normals[tri * 3 + 2]! * dz) * -inward >
        0
    const hit = bvh.raycast(x, y, z, dx, dy, dz, 1e-4, Infinity, exits)
    if (hit) readings.push({ t: hit.t, at: [x, y, z] })
  }
  readings.sort((u, v) => u.t - v.t)
  const thin = readings.filter((r) => r.t < opts.threshold)
  const radius = opts.regionRadius ?? 1
  const regions: ThinRegion[] = []
  for (const r of thin) {
    const near = regions.find(
      (g) => Math.hypot(g.at[0] - r.at[0], g.at[1] - r.at[1], g.at[2] - r.at[2]) < radius,
    )
    if (near) near.samples++
    else regions.push({ thicknessMm: r.t, at: r.at, samples: 1 })
  }
  return {
    samples: readings.length,
    excluded,
    minMm: readings[0]?.t ?? Number.POSITIVE_INFINITY,
    medianMm: readings[readings.length >> 1]?.t ?? Number.POSITIVE_INFINITY,
    thinFraction: readings.length ? thin.length / readings.length : 0,
    regions: regions.slice(0, opts.maxRegions ?? 5),
  }
}
