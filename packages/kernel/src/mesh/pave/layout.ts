/**
 * `paveSurface` layout (docs/research/06-freeform.md §5, steps 1–4): packs round stones of
 * stock sizes over a sampled surface region.
 *
 *  1. Each sample gets an allowed diameter: the edge margin, the curvature caps (stone ≤ R/3 on
 *     convex, ≤ R/5 on concave surfaces) and the thickness cap (seat + 0.4 mm of metal below;
 *     the drill hole under the seat only takes what metal is left beyond that).
 *  2. Outline rows, face by face: where a face is a band (a stroke, a step, a rim) it gets the
 *     rows its width takes, staggered about its ridge; an open field gets one row hugging its
 *     edge. Rows follow level sets of the distance to the edge (rows.ts), the way setters pave
 *     letters and framed fields.
 *  3. Honeycomb inside: advancing fronts from the deepest free points, every new stone tangent
 *     to two placed neighbours (gap included) in their tangent plane, then snapped back onto the
 *     surface. On a flat field of one size this *is* a honeycomb; on curved ones the lattice
 *     bends with the surface.
 *  4. Voids left where fronts and rows meet are filled largest size first.
 *  5. The ice level keeps stones in the order ice spreads from the heart of the region through
 *     neighbouring stones, so lowering it shrinks the iced patch instead of thinning it out —
 *     and never moves a stone.
 *
 * Deterministic: the only randomness is the seeded lattice phase.
 */
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../../geometry/vec'
import { PointGrid } from '../grid'
import { MinHeap } from '../heap'
import { seededRandom } from '../random'
import { walkLevelSets } from './rows'
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
  /** Depth of the blind drill hole below the culet that the metal under the seat allows, mm. */
  hole: number
}

export interface Layout {
  stones: PlacedStone[]
  /** Area the full (ice level 1) packing covers, each stone counted with half the gap, mm². */
  packedArea: number
  /** Share of the region where the smallest stone is allowed (not too curved, thin or near an edge). */
  fillable: number
}

/** Metal under a seat, and seat depth per mm of stone (06-freeform.md §5 step 1). */
const FLOOR_METAL = 0.4
const SEAT_DEPTH_PER_MM = 0.65
/** The drill hole under a seat reaches at most one stone deeper, and never into the floor metal. */
const MAX_HOLE_PER_MM = 1
/** Stones are at most R/3 (convex) or R/5 (concave) of the local radius of curvature. */
const CONVEX_CAP = 3
const CONCAVE_CAP = 5
/** Construction slack so snapping onto a curved surface never closes a gap below spec. */
const SLACK = 0.012
/** Overlaps up to this share of a stone are construction drift, settled rather than refused. */
const DRIFT = 0.06
/** Depth changing this many times faster across a seed than along it marks a band. */
const BAND_ANISOTROPY = 1.5
/** A single row is re-centred within ±CENTRE_REACH of a stone across its band, in this many steps a side. */
const CENTRE_REACH = 0.35
const CENTRE_STEPS = 7
/** More rows in a band must pack this much more stone area per length to be chosen. */
const MORE_ROWS = 1.08
/** A band's width is read along its ridge within this many stones of the seed, at this percentile. */
const BAND_REACH = 5
const RIDGE_PERCENTILE = 0.5
/** Row spacing of a honeycomb per unit of pitch. */
const ROW_SPACING = Math.sqrt(3) / 2
/** Regions whose bands are wider than this many stones are open fields, framed by one row. */
const OPEN_FIELD = 2
/**
 * A face's rows are planned for its narrower strokes (this percentile of its ridge), so a letter
 * whose strokes differ in width gets rows that fit all of them.
 */
const FACE_PERCENTILE = 0.25
/** A row on a band's ridge follows the level this share of a stone inside it (the ridge itself is a kink). */
const RIDGE_INSET = 0.03
/** Outline rows are walked in steps of this share of a stone; the first spot that fits takes it. */
const ROW_STEP = 0.04
/** After a stone, the walk strides this share of it: the next one cannot fit any sooner. */
const ROW_STRIDE = 0.85
/** Faces are joined through samples this many spacings inside the edge, linked this far apart. */
const FACE_INTERIOR = 0.6
const FACE_LINK = 1.8
/** Stones whose gap is up to this much wider than specified are neighbours when ice spreads. */
const NEIGHBOUR_SLACK = 0.3
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
  /** Per sample: 1 on a ridge of the edge distance, 0 not, −1 not yet known. */
  private readonly ridge: Int8Array
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
    this.ridge = new Int8Array(surface.count).fill(-1)
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
    this.layOutlineRows()
    let first = true
    for (;;) {
      const seed = this.nextSeed()
      if (seed < 0) break
      this.grow(seed, first)
      first = false
    }
    for (const size of this.sizes) this.fillVoids(size)
    const full = this.stones.reduce(
      (sum, s) => sum + Math.PI * (s.diameter / 2 + this.o.gap / 2) ** 2,
      0,
    )
    let fillable = 0
    for (let i = 0; i < this.surface.count; i++) if (this.sizeAt(i) > 0) fillable++
    return {
      stones: this.select(full),
      packedArea: full,
      fillable: this.surface.count > 0 ? fillable / this.surface.count : 0,
    }
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
    const spare = this.surface.thickness(sample) - SEAT_DEPTH_PER_MM * d - FLOOR_METAL
    const hole = Math.min(Math.max(spare, 0), MAX_HOLE_PER_MM * d)
    this.stones.push({ position: c, normal: n, diameter: d, hole })
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
   * The deepest live sample with room for a stone; once any stone is placed, only where a row
   * of three fits along the local row direction, so new fronts start in unreached parts rather
   * than in the gaps between fronts and rows, which are filled afterwards. Stones are only ever added, so a rejected sample stays rejected: the scan
   * resumes after the previous seed.
   */
  private nextSeed(): number {
    for (; this.seedCursor < this.order.length; this.seedCursor++) {
      const i = this.order[this.seedCursor]!
      if (this.dead[i] || this.sizeAt(i) === 0) continue
      const p = this.surface.point(i)
      const n = this.surface.normal(i)
      // The cheap test first: most samples left are beside a stone, not in a free part.
      if (!this.fits(p, n, this.smallest)) continue
      const d = this.sizeFor(i, p)
      if (d === 0 || !this.fits(p, n, d)) continue
      if (this.stones.length > 0 && !this.roomForRow(i, p, n, d)) continue
      // Consumed either way: a front that cannot start here never will.
      this.seedCursor++
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
      mean - spread > 0 ? (mean + spread) / (mean - spread) > BAND_ANISOTROPY : spread > 0
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
    return {
      rows: normalize(add(scale(e, Math.cos(angle)), scale(f, Math.sin(angle)))),
      banded: band,
    }
  }

  /**
   * The rows a band `across` mm wide takes: k staggered rows of diameter d need
   * d + (k − 1)(d + gap)·√3/2, and the choice packs the most stone area per length
   * (k·d²/(d + gap)) — so a 3 mm stroke gets two rows of 1.3 mm instead of one row of 1.6 mm
   * with slivers of metal beside it, the way setters pave letters. Null when nothing fits.
   */
  private rowsFor(across: number, cap: number): { rows: number; d: number } | null {
    let best: { rows: number; d: number } | null = null
    let bestScore = 0
    for (let rows = 1; rows <= 3; rows++) {
      const extra = (rows - 1) * ROW_SPACING
      const d = this.stock(Math.min(cap, (across - extra * this.o.gap) / (1 + extra)))
      if (d === 0) continue
      const score = (rows * d * d) / (d + this.o.gap)
      if (score > bestScore * MORE_ROWS) {
        best = { rows, d }
        bestScore = score
      }
    }
    return best
  }

  /** A band front lays uniform rows planned for the band's width (see `ridgeHalfWidth`). */
  private bandPlan(seed: number): FrontPlan {
    const s = this.surface
    const half = this.ridgeHalfWidth((visit) =>
      s.near(s.point(seed), BAND_REACH * this.largest, visit),
    )
    const fit = this.rowsFor(2 * (half - this.o.margin), this.sizeAt(seed))
    return fit ? { limit: fit.d, uniform: true, rows: fit.rows } : this.openField()
  }

  /**
   * Half-width of bands: a low percentile of the depth along their ridges among the samples
   * `among` visits, not the depth at any one point. Seeds are the deepest points left, which in
   * a letter are the junctions of its strokes; planning for the strokes' own width keeps rows
   * unbroken and gives every stroke of a letter the same stones. Infinity without a ridge.
   */
  private ridgeHalfWidth(
    among: (visit: (i: number) => void) => void,
    percentile = RIDGE_PERCENTILE,
  ): number {
    const ridge: number[] = []
    among((i) => {
      if (this.isRidge(i)) ridge.push(this.surface.edge[i]!)
    })
    if (ridge.length === 0) return Infinity
    ridge.sort((a, b) => a - b)
    return ridge[Math.floor(percentile * (ridge.length - 1))]!
  }

  /** No sample within a quarter stone is farther from the edge: the sample is on a ridge. */
  private isRidge(i: number): boolean {
    let r = this.ridge[i]!
    if (r < 0) {
      const s = this.surface
      const e = s.edge[i]!
      r = 1
      s.near(s.point(i), Math.max(2.5 * s.spacing, 0.25 * this.largest), (j) => {
        if (s.edge[j]! > e + EPS) r = 0
      })
      this.ridge[i] = r
    }
    return r === 1
  }

  /**
   * Faces of the region: samples joined through the interior, never across its edges or
   * creases, so each face of a stepped plinth or each side of a cut gem shape is planned for
   * its own width. Samples on an edge join the face of their nearest interior neighbour.
   */
  private faces(): { id: Int32Array; count: number } {
    const s = this.surface
    const id = new Int32Array(s.count).fill(-1)
    const interior = (i: number) => s.edge[i]! > FACE_INTERIOR * s.spacing
    const link = FACE_LINK * s.spacing
    let count = 0
    const stack: number[] = []
    for (let i = 0; i < s.count; i++) {
      if (id[i]! >= 0 || !interior(i)) continue
      id[i] = count
      stack.push(i)
      while (stack.length > 0) {
        const k = stack.pop()!
        s.near(s.point(k), link, (j) => {
          if (id[j]! < 0 && interior(j)) {
            id[j] = count
            stack.push(j)
          }
        })
      }
      count++
    }
    for (let i = 0; i < s.count; i++) {
      if (id[i]! >= 0) continue
      let best = Infinity
      s.near(s.point(i), 3 * link, (j, d2) => {
        if (interior(j) && d2 < best) {
          best = d2
          id[i] = id[j]!
        }
      })
    }
    return { id, count }
  }

  // ── Outline rows ───────────────────────────────────────────────────────────────────────────

  /**
   * Rows that follow the region's outline, laid before any honeycomb, face by face: in bands
   * (strokes, steps, rims) the rows the band's width takes; in open fields one row of the
   * largest stones. The outer rows hug the rim at the margin — a constant offset from the edge,
   * so they run straight along tapering or uneven strokes — and an odd middle row follows the
   * band's ridge.
   */
  private layOutlineRows(): void {
    const faces = this.faces()
    const members: number[][] = Array.from({ length: faces.count }, () => [])
    for (let i = 0; i < this.surface.count; i++)
      if (faces.id[i]! >= 0) members[faces.id[i]!]!.push(i)
    for (let f = 0; f < faces.count; f++) {
      const half = this.ridgeHalfWidth((visit) => members[f]!.forEach(visit), FACE_PERCENTILE)
      const fit =
        half < OPEN_FIELD * this.largest
          ? this.rowsFor(2 * (half - this.o.margin), this.largest)
          : null
      const d = fit?.d ?? this.largest
      const levels = [this.o.margin + d / 2 + SLACK]
      if (fit && fit.rows % 2 === 1 && fit.rows > 1) levels.push(half - RIDGE_INSET * d)
      for (const level of levels)
        walkLevelSets({
          surface: this.surface,
          edgeDistance: this.o.edgeDistance,
          level,
          step: ROW_STEP * d,
          starts: members[f]!,
          visit: (p, n, sample) => {
            this.tick()
            if (!this.fits(p, n, d) || this.sizeFor(sample, p) < d - EPS) return 0
            this.place(p, n, d, sample)
            return ROW_STRIDE * d
          },
          checkpoint: this.o.checkpoint,
        })
    }
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
        add(add(start, scale(rows, (this.random() - 0.5) * pitch)), scale(cross(n0, rows), across)),
      )
      const here = this.snap(start)
      const d = shifted ? this.sizeFor(shifted.sample, shifted.p) : 0
      if (
        shifted &&
        here &&
        d >= this.sizeFor(here.sample, here.p) &&
        this.fits(shifted.p, shifted.n, d)
      )
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
      // Nothing fits beside the pair. In a one-row band, continue the row in line with the pair;
      // an open field's front stops where the region narrows, and the narrow part gets a front
      // of its own, planned for its width.
      if (grew || this.front.rows !== 1) continue
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

  /**
   * The ice level: stones in the order ice spreads over the field, until `coverage` of it is
   * kept. Ice starts at the heart of the region (its deepest stone) and spreads through
   * neighbouring stones, so a part-iced piece shows one solid patch growing outward and whole
   * sections (a bowl, a step) filled before the next — never a sprinkle across the region. Stones
   * are only dropped, never moved.
   */
  private select(full: number): PlacedStone[] {
    if (this.o.coverage >= 1) return this.stones
    const order = this.spreadOrder()
    const keep = new Set<number>()
    let area = 0
    for (const i of order) {
      if (area >= this.o.coverage * full) break
      keep.add(i)
      area += Math.PI * (this.stones[i]!.diameter / 2 + this.o.gap / 2) ** 2
    }
    return this.stones.filter((_, i) => keep.has(i))
  }

  /** Stones by distance through their neighbours from the deepest one; each separate patch after the last, deepest first. */
  private spreadOrder(): number[] {
    const n = this.stones.length
    const done = new Uint8Array(n)
    const dist = new Float64Array(n).fill(Infinity)
    const byDepth = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => this.depth[b]! - this.depth[a]! || a - b,
    )
    const order: number[] = []
    const reach = this.largest + this.o.gap + NEIGHBOUR_SLACK
    for (const source of byDepth) {
      if (done[source]) continue
      const heap = new MinHeap()
      dist[source] = 0
      heap.push(source, 0)
      while (heap.size > 0) {
        const [i, d] = heap.pop()
        if (done[i] || d > dist[i]!) continue
        done[i] = 1
        order.push(i)
        const c = this.stones[i]!.position
        this.grid.near(c[0], c[1], c[2], reach, (j, d2) => {
          const nd = d + Math.sqrt(d2)
          if (!done[j] && nd < dist[j]!) {
            dist[j] = nd
            heap.push(j, nd)
          }
        })
      }
    }
    return order
  }
}
