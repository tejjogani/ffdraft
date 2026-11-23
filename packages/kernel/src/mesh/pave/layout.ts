/**
 * `paveSurface` layout (docs/research/06-freeform.md §5, steps 1–4): packs round stones of
 * stock sizes over a sampled surface region.
 *
 *  1. Each sample gets an allowed diameter: the edge margin, the curvature caps (stone ≤ R/3 on
 *     convex, ≤ R/5 on concave surfaces) and the thickness cap (seat + 0.4 mm of metal below).
 *  2. Advancing front from the heart of the region: every new stone is tangent to two placed
 *     neighbours (gap included) in their tangent plane, then snapped back onto the surface. On a
 *     flat field of one size this *is* a honeycomb; on curved ones the lattice bends with the
 *     surface. Fronts are re-seeded in parts of the region the first one cannot reach.
 *  3. Voids left where fronts meet or the region narrows are filled largest size first.
 *  4. The ice level keeps the stones nearest the heart of the region, so lowering it shrinks
 *     the field from its edges instead of thinning it out — and never moves a stone.
 *
 * Deterministic: the only randomness is the seeded lattice phase.
 */
import { type Vec3, add, cross, dot, normalize, scale, sub } from '../../geometry/vec'
import { PointGrid } from '../grid'
import { seededRandom } from '../random'
import type { PaveSurface } from './surface'

export interface LayoutOptions {
  /** Allowed stock diameters, largest first. */
  sizes: readonly number[]
  gap: number
  margin: number
  /** Fraction of the packed field to keep (the ice level). */
  coverage: number
  seed: number
  /** Rows of the honeycomb follow this direction where the surface allows. */
  rowDirection: Vec3
  /** Depth of the girdle below the surface per mm of stone diameter. */
  sink: number
  /** Exact distance from a surface point to the region's edge (samples only approximate it). */
  edgeDistance: (p: Vec3) => number
  /** Called now and then so long layouts can be aborted. */
  checkpoint?: () => void
}

export interface PlacedStone {
  /** Centre of the girdle, `sink · diameter` below the surface along the normal. */
  position: Vec3
  /** Smoothed surface normal over the footprint. */
  normal: Vec3
  diameter: number
}

export interface Layout {
  stones: PlacedStone[]
  /** Area the full (ice level 1) packing covers, each stone counted with half the gap, mm². */
  packedArea: number
}

/** Metal under a seat, and seat depth per mm of stone (06-freeform.md §5 step 1). */
const FLOOR_METAL = 0.4
const SEAT_DEPTH_PER_MM = 0.65
/** Stones are at most R/3 (convex) or R/5 (concave) of the local radius of curvature. */
const CONVEX_CAP = 3
const CONCAVE_CAP = 5
/** Construction slack so snapping onto a curved surface never closes a gap below spec. */
const SLACK = 0.004
const EPS = 1e-9

export function layoutPave(surface: PaveSurface, options: LayoutOptions): Layout {
  return new Packer(surface, options).run()
}

class Packer {
  private readonly sizes: readonly number[]
  private readonly smallest: number
  private readonly largest: number
  private readonly allowed: Float32Array
  private readonly dead: Uint8Array
  /** Samples from the heart of the region outward. */
  private readonly order: Uint32Array
  private readonly grid: PointGrid
  private readonly stones: PlacedStone[] = []
  private readonly depth: number[] = []
  private readonly random: () => number
  private work = 0
  private seedCursor = 0

  constructor(
    private readonly surface: PaveSurface,
    private readonly o: LayoutOptions,
  ) {
    this.sizes = o.sizes
    this.largest = o.sizes[0]!
    this.smallest = o.sizes.at(-1)!
    this.allowed = new Float32Array(surface.count).fill(-1)
    this.dead = new Uint8Array(surface.count)
    const ids = Array.from({ length: surface.count }, (_, i) => i)
    ids.sort((a, b) => surface.depth[b]! - surface.depth[a]! || a - b)
    this.order = Uint32Array.from(ids)
    this.grid = new PointGrid(this.largest + o.gap)
    this.random = seededRandom(o.seed)
  }

  run(): Layout {
    let first = true
    for (;;) {
      const seed = this.nextSeed(first)
      if (seed < 0) break
      this.grow(seed, first)
      first = false
    }
    for (const size of this.sizes) this.fillVoids(size)
    const full = this.stones.reduce((sum, s) => sum + Math.PI * (s.diameter / 2 + this.o.gap / 2) ** 2, 0)
    return { stones: this.select(full), packedArea: full }
  }

  private tick(): void {
    if (++this.work % 256 === 0) this.o.checkpoint?.()
  }

  // ── Fields ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Largest stock diameter the curvature at sample i allows, bounded by the margin (0 when none
   * fits). Cheap; the exact margin and the thickness under the seat are checked by `sizeFor`
   * only where a stone is actually being placed.
   */
  private sizeAt(i: number): number {
    let d = this.allowed[i]!
    if (d >= 0) return d
    const s = this.surface
    // Footprints snap up to 2.5 spacings from their sample, so the sample's margin is a bound.
    let limit = Math.min(this.largest, 2 * (s.edge[i]! + 2.5 * s.spacing - this.o.margin))
    if (s.convex[i]! > 0) limit = Math.min(limit, 1 / (CONVEX_CAP * s.convex[i]!))
    if (s.concave[i]! > 0) limit = Math.min(limit, 1 / (CONCAVE_CAP * s.concave[i]!))
    d = this.stock(limit)
    this.allowed[i] = d
    return d
  }

  /** The largest allowed stock size not above `limit`, or 0. */
  private stock(limit: number): number {
    return this.sizes.find((size) => size <= limit + EPS) ?? 0
  }

  private snap(q: Vec3): ReturnType<PaveSurface['snap']> {
    return this.surface.snap(q)
  }

  /**
   * Largest stock diameter for a footprint centred on surface point p near sample i: the
   * curvature cap, the exact margin at p, and the thickness cap (a seat ≈ 0.65 d deep with
   * 0.4 mm of metal left under it).
   */
  private sizeFor(i: number, p: Vec3): number {
    const d = this.sizeAt(i)
    if (d === 0) return 0
    const margin = 2 * (this.o.edgeDistance(p) - this.o.margin)
    const thickness = (this.surface.thickness(i) - FLOOR_METAL) / SEAT_DEPTH_PER_MM
    return this.stock(Math.min(d, margin, thickness))
  }

  /** Girdle centre of a stone of diameter d whose footprint is centred on surface point p. */
  private girdle(p: Vec3, n: Vec3, d: number): Vec3 {
    return sub(p, scale(n, this.o.sink * d))
  }

  /** Gaps are kept between girdles, which on a curved surface are closer than the footprints. */
  private fits(p: Vec3, n: Vec3, d: number): boolean {
    const c = this.girdle(p, n, d)
    let ok = true
    this.grid.near(c[0], c[1], c[2], d / 2 + this.largest / 2 + this.o.gap, (j, d2) => {
      const min = (d + this.stones[j]!.diameter) / 2 + this.o.gap
      if (d2 < (min - EPS) * (min - EPS)) ok = false
    })
    return ok
  }

  private place(p: Vec3, n: Vec3, d: number, sample: number): number {
    const index = this.stones.length
    const c = this.girdle(p, n, d)
    this.stones.push({ position: c, normal: n, diameter: d })
    this.depth.push(this.surface.depth[sample]!)
    this.grid.add(c[0], c[1], c[2])
    // No stone centre can ever be this close to the new stone again.
    this.surface.near(p, d / 2 + this.smallest / 2 + this.o.gap - EPS, (j) => {
      this.dead[j] = 1
    })
    return index
  }

  // ── Fronts ─────────────────────────────────────────────────────────────────────────────────

  /**
   * The deepest live sample with room for a stone; after the first front, only where a whole
   * ring of stones would fit, so new fronts start in unreached parts rather than in gaps.
   * Stones are only ever added, so a rejected sample stays rejected: the scan resumes where the
   * previous one stopped.
   */
  private nextSeed(first: boolean): number {
    const clearance = first ? 0 : 2 * (this.largest + this.o.gap)
    for (; this.seedCursor < this.order.length; this.seedCursor++) {
      const i = this.order[this.seedCursor]!
      if (this.dead[i] || this.sizeAt(i) === 0) continue
      const p = this.surface.point(i)
      const n = this.surface.normal(i)
      const d = this.sizeFor(i, p)
      if (d === 0 || !this.fits(p, n, d)) continue
      if (clearance > 0) {
        let crowded = false
        this.grid.near(p[0], p[1], p[2], clearance + d, () => {
          crowded = true
        })
        if (crowded) continue
      }
      return i
    }
    return -1
  }

  /** Rows direction in the tangent plane at a point (falls back to any tangent). */
  private rowsAt(n: Vec3): Vec3 {
    const angle = (((this.o.seed - 1) * 23) % 60) * (Math.PI / 180)
    let e = sub(this.o.rowDirection, scale(n, dot(this.o.rowDirection, n)))
    if (Math.hypot(e[0], e[1], e[2]) < 1e-3) e = cross(n, [0, 0, 1])
    e = normalize(e, normalize(cross(n, [1, 0, 0])))
    const f = cross(n, e)
    return normalize(add(scale(e, Math.cos(angle)), scale(f, Math.sin(angle))))
  }

  private grow(seed: number, first: boolean): void {
    let start = this.surface.point(seed)
    const n0 = this.surface.normal(seed)
    const rows = this.rowsAt(n0)
    if (first) {
      // Seeded phase: shift the lattice by up to half a pitch so layouts differ per seed.
      const pitch = this.largest + this.o.gap
      const shifted = this.snap(
        add(add(start, scale(rows, (this.random() - 0.5) * pitch)), scale(cross(n0, rows), (this.random() - 0.5) * pitch)),
      )
      const d = shifted ? this.sizeFor(shifted.sample, shifted.p) : 0
      if (shifted && d > 0 && this.fits(shifted.p, shifted.n, d)) start = shifted.p
    }
    const root = this.snap(start)
    if (!root) return
    const d0 = this.sizeFor(root.sample, root.p)
    if (d0 === 0 || !this.fits(root.p, root.n, d0)) return
    const a = this.place(root.p, root.n, d0, root.sample)

    // The second stone sets the row direction; try the six lattice directions in turn.
    let b = -1
    for (let k = 0; k < 6 && b < 0; k++) {
      const angle = (k * Math.PI) / 3
      const dir = normalize(add(scale(rows, Math.cos(angle)), scale(cross(root.n, rows), Math.sin(angle))))
      b = this.besideAlong(a, dir)
    }
    if (b < 0) return

    // FIFO of stone pairs: (i, j, k) means "place a stone tangent to i and j, on the side away
    // from k" (k < 0: both sides). Breadth-first growth keeps the lattice regular.
    const queue: [number, number, number][] = [[a, b, -1]]
    for (let head = 0; head < queue.length; head++) {
      this.tick()
      const [i, j, away] = queue[head]!
      let grew = false
      for (const side of away < 0 ? [1, -1] : [this.sideAwayFrom(i, j, away)]) {
        const k = this.tangentTo(i, j, side)
        if (k < 0) continue
        queue.push([i, k, j], [k, j, i])
        grew = true
      }
      if (grew) continue
      // Nothing fits beside the pair: the region is one stone wide here (a strip, a thin
      // stroke), so continue the row in line with the pair, following the surface.
      for (const [from, to] of [
        [i, j],
        [j, i],
      ] as const) {
        const k = this.besideAlong(to, normalize(sub(this.stones[to]!.position, this.stones[from]!.position)))
        if (k >= 0) queue.push([to, k, -1])
      }
    }
  }

  /** A stone next to stone a in direction dir (gap apart), or -1. */
  private besideAlong(a: number, dir: Vec3): number {
    const sa = this.stones[a]!
    let r = this.largest / 2
    for (let iter = 0; iter < 4; iter++) {
      const hit = this.snap(add(sa.position, scale(dir, sa.diameter / 2 + r + this.o.gap + SLACK)))
      if (!hit) return -1
      const d = this.sizeFor(hit.sample, hit.p)
      if (d === 0) return -1
      if (d / 2 >= r - EPS) return this.fits(hit.p, hit.n, 2 * r) ? this.place(hit.p, hit.n, 2 * r, hit.sample) : -1
      r = d / 2
    }
    return -1
  }

  private sideAwayFrom(i: number, j: number, k: number): number {
    const a = this.stones[i]!
    const b = this.stones[j]!
    const m = normalize(add(a.normal, b.normal))
    const e2 = cross(m, sub(b.position, a.position))
    return dot(sub(this.stones[k]!.position, a.position), e2) > 0 ? -1 : 1
  }

  /** Places a stone tangent to stones i and j on `side`; returns its index or -1. */
  private tangentTo(i: number, j: number, side: number): number {
    let r = this.largest / 2
    for (let attempt = 0; attempt < 4; attempt++) {
      const hit = this.tangentPoint(i, j, r, side)
      if (!hit) return -1
      const d = this.sizeFor(hit.sample, hit.p)
      if (d === 0) return -1
      if (d / 2 >= r - EPS) return this.fits(hit.p, hit.n, 2 * r) ? this.place(hit.p, hit.n, 2 * r, hit.sample) : -1
      r = d / 2
    }
    return -1
  }

  /**
   * The footprint whose girdle is rᵢ + r + gap from stone i's and rⱼ + r + gap from stone j's,
   * found in the girdles' plane, snapped onto the surface and refined twice in the candidate's
   * own plane.
   */
  private tangentPoint(i: number, j: number, r: number, side: number): ReturnType<PaveSurface['snap']> {
    const a = this.stones[i]!
    const b = this.stones[j]!
    const da = a.diameter / 2 + r + this.o.gap + SLACK
    const db = b.diameter / 2 + r + this.o.gap + SLACK
    let n = normalize(add(a.normal, b.normal))
    let origin = scale(add(a.position, b.position), 0.5)
    let hit: ReturnType<PaveSurface['snap']> = null
    for (let iter = 0; iter < 3; iter++) {
      const pa = sub(a.position, scale(n, dot(sub(a.position, origin), n)))
      const pb = sub(b.position, scale(n, dot(sub(b.position, origin), n)))
      const axis = sub(pb, pa)
      const len = Math.hypot(axis[0], axis[1], axis[2])
      if (len < EPS) return null
      const e1 = scale(axis, 1 / len)
      const e2 = cross(n, e1)
      const x = (da * da - db * db + len * len) / (2 * len)
      const y2 = da * da - x * x
      if (y2 <= 0) return null
      hit = this.snap(add(add(pa, scale(e1, x)), scale(e2, side * Math.sqrt(y2))))
      if (!hit) return null
      n = hit.n
      origin = this.girdle(hit.p, hit.n, 2 * r)
    }
    return hit
  }

  // ── Voids and selection ────────────────────────────────────────────────────────────────────

  /** Places stones of one size wherever they still fit, deepest samples first. */
  private fillVoids(size: number): void {
    for (const i of this.order) {
      if (this.dead[i] || this.sizeAt(i) < size - EPS) continue
      this.tick()
      const p = this.surface.point(i)
      const n = this.surface.normal(i)
      if (this.fits(p, n, size) && this.sizeFor(i, p) >= size - EPS) this.place(p, n, size, i)
    }
  }

  /** The stones nearest the heart of the region until `coverage` of the field is kept. */
  private select(full: number): PlacedStone[] {
    if (this.o.coverage >= 1) return this.stones
    const ids = this.stones.map((_, i) => i).sort((a, b) => this.depth[b]! - this.depth[a]! || a - b)
    const keep = new Set<number>()
    let area = 0
    for (const i of ids) {
      if (area >= this.o.coverage * full) break
      keep.add(i)
      area += Math.PI * (this.stones[i]!.diameter / 2 + this.o.gap / 2) ** 2
    }
    return this.stones.filter((_, i) => keep.has(i))
  }
}
