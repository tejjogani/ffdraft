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
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../../geometry/vec'
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
const SLACK = 0.012
/** Overlaps up to this share of a stone are construction drift, settled rather than refused. */
const DRIFT = 0.06
/** Depth changing this many times faster across a seed than along it marks a band. */
const BAND_ANISOTROPY = 4
/** A single row is re-centred within ±CENTRE_REACH of a stone across its band, in this many steps a side. */
const CENTRE_REACH = 0.35
const CENTRE_STEPS = 7
/** More rows in a band must pack this much more stone area per length to be chosen. */
const MORE_ROWS = 1.08
/** Row spacing of a honeycomb per unit of pitch. */
const ROW_SPACING = Math.sqrt(3) / 2
const EPS = 1e-9

type Hit = NonNullable<ReturnType<PaveSurface['snap']>>

/** The stones a front lays: up to `limit` across, only that size when `uniform`, in `rows`. */
interface FrontPlan {
  limit: number
  uniform: boolean
  rows: number
}

export function layoutPave(surface: PaveSurface, options: LayoutOptions): Layout {
  return new Packer(surface, options).run()
}

class Packer {
  private readonly sizes: readonly number[]
  private readonly smallest: number
  private readonly largest: number
  private readonly allowed: Float64Array
  private readonly dead: Uint8Array
  /** Samples from the heart of the region outward. */
  private readonly order: Uint32Array
  private readonly grid: PointGrid
  private readonly stones: PlacedStone[] = []
  private readonly depth: number[] = []
  private readonly random: () => number
  private work = 0
  private seedCursor = 0
  private front: FrontPlan

  constructor(
    private readonly surface: PaveSurface,
    private readonly o: LayoutOptions,
  ) {
    this.sizes = o.sizes
    this.largest = o.sizes[0]!
    this.smallest = o.sizes.at(-1)!
    this.allowed = new Float64Array(surface.count).fill(-1)
    this.dead = new Uint8Array(surface.count)
    const ids = Array.from({ length: surface.count }, (_, i) => i)
    ids.sort((a, b) => surface.depth[b]! - surface.depth[a]! || a - b)
    this.order = Uint32Array.from(ids)
    this.grid = new PointGrid(this.largest + o.gap)
    this.random = seededRandom(o.seed)
    this.front = this.openField()
  }

  private openField(): FrontPlan {
    return { limit: this.largest, uniform: false, rows: 0 }
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
    const full = this.stones.reduce(
      (sum, s) => sum + Math.PI * (s.diameter / 2 + this.o.gap / 2) ** 2,
      0,
    )
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
    return this.stock(Math.min(d, margin, thickness, this.front.limit))
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

  /**
   * Places a stone of diameter d at a candidate footprint, first nudging it out of overlaps of up
   * to `DRIFT` of its diameter. Positions built from neighbours carry their rounding and the
   * curvature of the surface along; without this, a stone that misses a third neighbour by a few
   * microns is rejected and leaves a hole in an otherwise perfect honeycomb. Returns -1 when it
   * still does not fit.
   */
  private placeSettled(hit: { sample: number; p: Vec3; n: Vec3 }, d: number): number {
    let cur = hit
    for (let iter = 0; iter < 4; iter++) {
      const c = this.girdle(cur.p, cur.n, d)
      let push: Vec3 = [0, 0, 0]
      let worst = 0
      this.grid.near(c[0], c[1], c[2], d / 2 + this.largest / 2 + this.o.gap, (j, d2) => {
        const other = this.stones[j]!
        const min = (d + other.diameter) / 2 + this.o.gap
        if (d2 >= (min - EPS) * (min - EPS)) return
        const dist = Math.sqrt(d2)
        worst = Math.max(worst, min - dist)
        const away = dist > EPS ? scale(sub(c, other.position), 1 / dist) : cur.n
        push = add(push, scale(away, min - dist + SLACK))
      })
        if (worst === 0) return this.place(cur.p, cur.n, d, cur.sample)
      if (worst > DRIFT * d) return -1
      const next = this.snap(add(cur.p, sub(push, scale(cur.n, dot(push, cur.n)))))
      if (!next || this.sizeFor(next.sample, next.p) < d - EPS) return -1
      cur = next
    }
    return -1
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
   * The deepest live sample with room for a stone; after the first front, only where a row of
   * three fits along the local row direction, so new fronts start in unreached parts (another
   * face, the next step of a plinth) rather than in the gaps between fronts, which are filled
   * afterwards. Stones are only ever added, so a rejected sample stays rejected: the scan
   * resumes where the previous one stopped.
   */
  private nextSeed(first: boolean): number {
    for (; this.seedCursor < this.order.length; this.seedCursor++) {
      const i = this.order[this.seedCursor]!
      if (this.dead[i] || this.sizeAt(i) === 0) continue
      const p = this.surface.point(i)
      const n = this.surface.normal(i)
      const d = this.sizeFor(i, p)
      if (d === 0 || !this.fits(p, n, d)) continue
      if (!first && !this.roomForRow(i, p, n, d)) continue
      return i
    }
    return -1
  }

  private roomForRow(i: number, p: Vec3, n: Vec3, d: number): boolean {
    const { rows } = this.rowsAt(i, n)
    for (const side of [1, -1]) {
      const q = this.snap(add(p, scale(rows, side * (d + this.o.gap + SLACK))))
      if (!q || this.sizeFor(q.sample, q.p) < d - EPS || !this.fits(q.p, q.n, d)) return false
    }
    return true
  }

  /**
   * Row direction at a seed: along the region where it is a band (so a stroke of a letter or the
   * face of a step is paved in rows that follow it), the preferred direction in open fields;
   * turned by the seed's lattice angle either way. Seeds sit on the ridge of the depth field,
   * where its gradient vanishes, so the band is read from how depth varies by direction: the
   * structure tensor Σ Δdepth² · t tᵀ of the unit tangent directions t to nearby samples has
   * its larger axis across the band.
   */
  private rowsAt(seed: number, n: Vec3): { rows: Vec3; banded: boolean } {
    const angle = (((this.o.seed - 1) * 23) % 60) * (Math.PI / 180)
    const p = this.surface.point(seed)
    const e1 = normalize(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))
    const e2 = cross(n, e1)
    let xx = 0
    let xy = 0
    let yy = 0
    this.surface.near(p, 2 * this.largest, (j, d2) => {
      if (d2 < EPS) return
      const dp = sub(this.surface.point(j), p)
      const u = dot(dp, e1)
      const v = dot(dp, e2)
      const w = (this.surface.depth[j]! - this.surface.depth[seed]!) ** 2 / d2
      const t2 = u * u + v * v || 1
      xx += (w * u * u) / t2
      xy += (w * u * v) / t2
      yy += (w * v * v) / t2
    })
    const mean = (xx + yy) / 2
    const spread = Math.hypot((xx - yy) / 2, xy)
    // Depth falls at least BAND_ANISOTROPY times faster across than along: a band.
    const banded =
      mean - spread > 0
        ? (mean + spread) / (mean - spread) > BAND_ANISOTROPY
        : spread > 0
    const band = banded && this.surface.depth[seed]! < 2 * this.largest
    let e: Vec3
    if (band) {
      // Eigenvector of the smaller eigenvalue: the direction along which depth stays level.
      const theta = 0.5 * Math.atan2(2 * xy, xx - yy) + Math.PI / 2
      e = add(scale(e1, Math.cos(theta)), scale(e2, Math.sin(theta)))
    } else e = sub(this.o.rowDirection, scale(n, dot(this.o.rowDirection, n)))
    if (Math.hypot(e[0], e[1], e[2]) < 1e-3) e = cross(n, [0, 0, 1])
    e = normalize(e, e1)
    const f = cross(n, e)
    return { rows: normalize(add(scale(e, Math.cos(angle)), scale(f, Math.sin(angle)))), banded: band }
  }

  /**
   * The rows a band takes: k staggered rows of diameter d need d + (k − 1)(d + gap)·√3/2 across,
   * and the choice packs the most stone area per length (k·d²/(d + gap)) — so a 3 mm stroke gets
   * two rows of 1.3 mm instead of one row of 1.6 mm with slivers of metal beside it, the way
   * setters pave letters. Every stone of the front then has that size, in rows along the band.
   */
  private bandPlan(seed: number): FrontPlan {
    const across = 2 * (this.surface.edge[seed]! - this.o.margin)
    const cap = this.sizeAt(seed)
    let best: FrontPlan = this.openField()
    let bestScore = 0
    for (let rows = 1; rows <= 3; rows++) {
      const extra = (rows - 1) * ROW_SPACING
      const d = this.stock(Math.min(cap, (across - extra * this.o.gap) / (1 + extra)))
      if (d === 0) continue
      const score = (rows * d * d) / (d + this.o.gap)
      if (score > bestScore * MORE_ROWS) {
        best = { limit: d, uniform: true, rows }
        bestScore = score
      }
    }
    return best
  }

  private grow(seed: number, first: boolean): void {
    const n0 = this.surface.normal(seed)
    const { rows, banded } = this.rowsAt(seed, n0)
    this.front = banded ? this.bandPlan(seed) : this.openField()
    try {
      this.growFront(seed, first, rows, banded)
    } finally {
      this.front = this.openField()
    }
  }

  private growFront(seed: number, first: boolean, rows: Vec3, banded: boolean): void {
    const n0 = this.surface.normal(seed)
    let start = this.surface.point(seed)
    if (this.front.rows > 1) {
      // The seed is on the band's centre line; the first row goes to one side of it.
      const offset = ((this.front.rows - 1) / 2) * (this.front.limit + this.o.gap) * ROW_SPACING
      const side = this.snap(sub(start, scale(cross(n0, rows), offset)))
      if (!side) return
      start = side.p
    }
    if (first) {
      // Seeded phase: shift the lattice by up to half a pitch so layouts differ per seed — only
      // along a band, never across it, and never onto a spot that takes a smaller stone.
      const pitch = this.front.limit + this.o.gap
      const across = banded ? 0 : (this.random() - 0.5) * pitch
      const shifted = this.snap(
        add(
          add(start, scale(rows, (this.random() - 0.5) * pitch)),
          scale(cross(n0, rows), across),
        ),
      )
      const here = this.snap(start)
      const d = shifted ? this.sizeFor(shifted.sample, shifted.p) : 0
      if (shifted && here && d >= this.sizeFor(here.sample, here.p) && this.fits(shifted.p, shifted.n, d))
        start = shifted.p
    }
    const root = this.snap(start)
    if (!root) return
    const d0 = this.sizeFor(root.sample, root.p)
    if (d0 === 0 || (this.front.uniform && d0 < this.front.limit - EPS)) return
    if (!this.fits(root.p, root.n, d0)) return
    const a = this.place(root.p, root.n, d0, root.sample)

    // The second stone sets the row direction; try the six lattice directions in turn (in a
    // band only along it, so the rows follow the band).
    let b = -1
    for (let k = 0; k < 6 && b < 0; k += banded ? 3 : 1) {
      const angle = (k * Math.PI) / 3
      const dir = normalize(
        add(scale(rows, Math.cos(angle)), scale(cross(root.n, rows), Math.sin(angle))),
      )
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
        const k = this.besideAlong(
          to,
          normalize(sub(this.stones[to]!.position, this.stones[from]!.position)),
        )
        if (k >= 0) queue.push([to, k, -1])
      }
    }
  }

  /** A stone next to stone a in direction dir (gap apart), or -1. */
  private besideAlong(a: number, dir: Vec3): number {
    const sa = this.stones[a]!
    let r = this.front.limit / 2
    for (let iter = 0; iter < 4; iter++) {
      let hit = this.snap(add(sa.position, scale(dir, sa.diameter / 2 + r + this.o.gap + SLACK)))
      if (hit && this.front.rows === 1) hit = this.centredAcross(hit, dir, 2 * r)
      if (!hit) return -1
      const d = this.sizeFor(hit.sample, hit.p)
      if (d === 0) return -1
      if (d / 2 >= r - EPS) return this.placeSettled(hit, 2 * r)
      if (this.front.uniform) return -1
      r = d / 2
    }
    return -1
  }

  /**
   * A single row keeps to the middle of its band: the footprint slid across the row to where
   * it is farthest from the region's edge. Following the previous two stones alone, a row
   * drifts off a curved or slanted stroke within a few stones and breaks.
   */
  private centredAcross(hit: Hit, dir: Vec3, d: number): Hit | null {
    const across = normalize(cross(hit.n, dir))
    let best = hit
    let bestEdge = this.o.edgeDistance(hit.p)
    for (let k = -CENTRE_STEPS; k <= CENTRE_STEPS; k++) {
      if (k === 0) continue
      const q = this.snap(add(hit.p, scale(across, (k / CENTRE_STEPS) * CENTRE_REACH * d)))
      if (!q) continue
      const e = this.o.edgeDistance(q.p)
      if (e > bestEdge + EPS) {
        best = q
        bestEdge = e
      }
    }
    return best
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
    let r = this.front.limit / 2
    for (let attempt = 0; attempt < 4; attempt++) {
      const hit = this.tangentPoint(i, j, r, side)
      if (!hit) return -1
      const d = this.sizeFor(hit.sample, hit.p)
      if (d === 0) return -1
      if (d / 2 >= r - EPS) return this.placeSettled(hit, 2 * r)
      if (this.front.uniform) return -1
      r = d / 2
    }
    return -1
  }

  /**
   * The footprint whose girdle is rᵢ + r + gap from stone i's and rⱼ + r + gap from stone j's,
   * found in the girdles' plane, snapped onto the surface and refined twice in the candidate's
   * own plane.
   */
  private tangentPoint(
    i: number,
    j: number,
    r: number,
    side: number,
  ): ReturnType<PaveSurface['snap']> {
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
      if (this.sizeFor(i, p) < size - EPS) continue
      // A void that only just takes the stone has a single spot where it fits, which a sample
      // seldom hits: so look for the spot tangent to the nearest stones even when p is taken.
      const snug = this.nestle(p, size)
      if (snug) this.place(snug.p, snug.n, size, snug.sample)
      else if (this.fits(p, n, size)) this.place(p, n, size, i)
    }
  }

  /**
   * A position for a void stone tangent to its two nearest neighbours, close to where it was
   * found — so fill stones line up with the field instead of landing wherever a sample was.
   */
  private nestle(p: Vec3, size: number): ReturnType<PaveSurface['snap']> {
    const near: [number, number][] = []
    this.grid.near(p[0], p[1], p[2], size + this.largest + 2 * this.o.gap, (j, d2) =>
      near.push([j, d2]),
    )
    if (near.length < 2) return null
    near.sort((a, b) => a[1] - b[1] || a[0] - b[0])
    const [i, j] = [near[0]![0], near[1]![0]]
    let best: ReturnType<PaveSurface['snap']> = null
    let bestD = 0.6 * size
    for (const side of [1, -1]) {
      const hit = this.tangentPoint(i, j, size / 2, side)
      if (!hit) continue
      const d = Math.hypot(hit.p[0] - p[0], hit.p[1] - p[1], hit.p[2] - p[2])
      if (
        d < bestD &&
        this.sizeFor(hit.sample, hit.p) >= size - EPS &&
        this.fits(hit.p, hit.n, size)
      ) {
        best = hit
        bestD = d
      }
    }
    return best
  }

  /** The stones nearest the heart of the region until `coverage` of the field is kept. */
  private select(full: number): PlacedStone[] {
    if (this.o.coverage >= 1) return this.stones
    const ids = this.stones
      .map((_, i) => i)
      .sort((a, b) => this.depth[b]! - this.depth[a]! || a - b)
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
