/**
 * Hollowing to a wall thickness. The cavity is the inward offset of the body by `wall` (a level
 * set of its distance field). On a flat-backed piece the offset is taken from the body *before*
 * the back was sliced off, so the cavity runs out through the flat back: the classic scooped
 * hip-hop back with a rim of `wall` all round. Every closed cavity gets two Ø2 mm escape holes
 * through the back (one where it is too small for two), per docs/research/02-production.md
 * (hollows: escape holes 4 mm × 1 or 2 mm × 2+, drains ≥ 1.5 mm).
 */
import type { Manifold } from 'manifold-3d'
import { runtime } from '../runtime/index'
import type { IndexedTriangles } from '../solid/meshing'
import { trianglesFromManifold } from '../solid/solid'
import { type ClosestHit, TriangleBvh } from './bvh'
import { keepPieces, SPECK_VOLUME } from './pieces'
import { type DistanceGrid, distanceGrid, levelSetOf, sampleDistance } from './sdf'

const DRAIN_RADIUS = 1
/**
 * Grid spacing as a fraction of the wall, and its bounds in mm. The cavity is never seen, so it
 * only needs to keep the wall: half a wall is plenty, and a few seconds at most.
 */
const SPACING_PER_WALL = 0.5
const MIN_SPACING = 0.15
const MAX_CELLS = 160

/** Cavity pieces smaller than this (mm³) are specks where the inset barely opens, not hollows. */
const MIN_CAVITY = 1
/**
 * The cavity is never seen, so its level-set mesh (hundreds of thousands of triangles on a
 * 40 mm piece) is thinned to this share of the wall before it is cut. The level set is taken
 * this much deeper than the wall, so the thinned faces never come closer to the outside than
 * the wall asked for, while its vertices (where thinning leaves the surface) lie only this
 * much farther: walls come out within a few per cent of the value asked for.
 */
const CAVITY_TOLERANCE = 0.04
/**
 * The cavity is opened (eroded, then dilated back) by this radius, mm: where the body is only a
 * little thicker than two walls the inset is a slit, which the level set breaks into a sheet
 * pierced by hundreds of pillars — handles investment cannot fill. Opened, such slits vanish
 * and those parts stay solid.
 */
const OPEN_RADIUS = 0.5
/** …and at least this many grid cells, below which a slit is a cell or two wide and survives. */
const OPEN_CELLS = 1.5

/** Loose pieces left by hollowing below this many cubic walls, and share of the body, are debris. */
const CRUMB_WALLS = 2
const CRUMB_SHARE = 0.01

/** Metal a hollow wall asked for comes out with, at least (its faces) and typically (its vertices). */
export const hollowWallMetal = (wall: number): number => wall * (1 + CAVITY_TOLERANCE)

export interface Hollowed {
  manifold: Manifold
  /** Escape holes drilled through the back (none where a cavity opens through a flat back). */
  drains: number
  /**
   * The surface that was cut away (cavities and their escape holes), in the body's space. Every
   * face of the result that lies on it is inside the piece: pavé must leave those faces alone.
   */
  cavity: IndexedTriangles
}

/**
 * `body` is the finished outer shape; `envelope` the same body before its back was flattened
 * (pass `body` again when there is no flat back). Every cavity that does not open through the
 * back gets its own escape holes, or is left solid when none can reach it — a sealed void
 * cannot be cast. Returns null when no cavity remains (the body is thinner than two walls).
 * The caller owns the returned Manifold.
 */
export function hollowBody(body: Manifold, envelope: Manifold, wall: number): Hollowed | null {
  const { manifold: mf } = runtime()
  const box = envelope.boundingBox()
  const extent = Math.max(...[0, 1, 2].map((k) => box.max[k]! - box.min[k]!))
  const spacing = Math.max(wall * SPACING_PER_WALL, MIN_SPACING, extent / MAX_CELLS)
  const level = hollowWallMetal(wall)
  const open = Math.max(OPEN_RADIUS, OPEN_CELLS * spacing)
  const outside = trianglesFromManifold(envelope)
  // The band must reach the eroded level, below which the opening starts.
  const grid = distanceGrid(outside, {
    spacing,
    band: level + open + 3 * spacing,
    votes: 1,
  })
  const opened = openedInset(grid, level, open)
  if (!opened) return null
  // Thinned before anything is decided from it: thinning later could close a cavity's opening
  // through the flat back, leaving a sealed void that was meant to be a scoop.
  const thinned = opened.simplify(wall * CAVITY_TOLERANCE)
  opened.delete()
  const inset = keepDepth(thinned, outside, level)
  thinned.delete()
  const pieces = inset.decompose()
  inset.delete()
  const owned: Manifold[] = [...pieces]
  try {
    const back = body.boundingBox().max[1]
    const tools: Manifold[] = []
    let drains = 0
    let outer: TriangleBvh | undefined
    for (const piece of pieces) {
      if (piece.volume() < MIN_CAVITY) continue
      if (piece.boundingBox().max[1] > back + 1e-6) {
        tools.push(piece)
        continue
      }
      outer ??= new TriangleBvh(trianglesFromManifold(body))
      const holes = drainHoles(piece, back, outer, wall)
      owned.push(...holes)
      if (holes.length === 0) continue
      tools.push(piece, ...holes)
      drains += holes.length
    }
    if (tools.length === 0) return null
    const tool = mf.Manifold.union(tools)
    owned.push(tool)
    const result = withoutDebris(body.subtract(tool), grid, wall)
    if (result.isEmpty() || result.volume() >= body.volume()) {
      result.delete()
      return null
    }
    return { manifold: result, drains, cavity: trianglesFromManifold(tool) }
  } finally {
    for (const m of owned) m.delete()
  }
}

/**
 * The region deeper than `level` inside the grid's surface, opened by `radius`: eroded (the
 * nodes `radius` deeper still), then dilated back by the distance to the eroded nodes, and
 * never beyond `level`. The distance comes from an exact transform of the grid itself, which
 * costs a fraction of a second where meshing the eroded region and sampling its distance
 * would double the time hollowing takes. Null when nothing survives the erosion.
 */
function openedInset(grid: DistanceGrid, level: number, radius: number): Manifold | null {
  const { values, spacing } = grid
  const count = values.length
  const d2 = new Float32Array(count)
  let core = 0
  for (let n = 0; n < count; n++)
    if (values[n]! > level + radius) {
      core++
      d2[n] = 0
    } else d2[n] = FAR
  if (core * spacing ** 3 < MIN_CAVITY) return null
  squaredDistanceTransform(d2, grid.size)
  const opened = new Float32Array(count)
  for (let n = 0; n < count; n++) {
    // The eroded region's edge lies between its nearest node and the next one out: half a
    // cell is the middle of that range.
    const toCore = d2[n] === 0 ? 0 : Math.max(0, (Math.sqrt(d2[n]!) - 0.5) * spacing)
    opened[n] = Math.min(values[n]! - level, radius - toCore)
  }
  return levelSetOf({ ...grid, values: opened }, 0)
}

/**
 * `cavity` with every vertex at least `level` inside the surface `outside`. Interpolating a
 * sampled distance overestimates it near the body's inner corners (the notches of a crown, the
 * root of a handle), where the cavity would otherwise come a tenth of a millimetre or more too
 * close; each such vertex is moved straight away from its nearest point of the surface.
 */
function keepDepth(cavity: Manifold, outside: IndexedTriangles, level: number): Manifold {
  const bvh = new TriangleBvh(outside)
  const hit: ClosestHit = { d2: 0, x: 0, y: 0, z: 0, triangle: -1 }
  return cavity.warp((v) => {
    if (!bvh.closest(v[0], v[1], v[2], hit, level)) return
    const d = Math.sqrt(hit.d2)
    if (d < 1e-9) return
    const push = (level - d) / d
    v[0] += (v[0] - hit.x) * push
    v[1] += (v[1] - hit.y) * push
    v[2] += (v[2] - hit.z) * push
  })
}

/** "Infinitely" far, squared, in grid cells: no grid is this large. */
const FAR = 1e12

/**
 * Exact squared Euclidean distance (in cells) from every node to the nearest node holding 0,
 * in place: one pass of the lower envelope of parabolas per axis (Felzenszwalb–Huttenlocher).
 */
function squaredDistanceTransform(d2: Float32Array, size: readonly [number, number, number]): void {
  const [nx, ny, nz] = size
  const longest = Math.max(nx, ny, nz)
  const f = new Float64Array(longest)
  const out = new Float64Array(longest)
  const v = new Int32Array(longest)
  const z = new Float64Array(longest + 1)
  const pass = (length: number, stride: number, starts: Iterable<number>) => {
    for (const start of starts) {
      for (let i = 0; i < length; i++) f[i] = d2[start + i * stride]!
      envelope(length)
      for (let i = 0; i < length; i++) d2[start + i * stride] = out[i]!
    }
  }
  const envelope = (n: number) => {
    let k = 0
    v[0] = 0
    z[0] = -Infinity
    z[1] = Infinity
    for (let q = 1; q < n; q++) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
      while (s <= z[k]!) {
        k--
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = Infinity
    }
    k = 0
    for (let q = 0; q < n; q++) {
      while (z[k + 1]! < q) k++
      out[q] = (q - v[k]!) ** 2 + f[v[k]!]!
    }
  }
  const rows = function* (outer: number, inner: number, outerStride: number, innerStride: number) {
    for (let a = 0; a < outer; a++)
      for (let b = 0; b < inner; b++) yield a * outerStride + b * innerStride
  }
  pass(nx, 1, rows(nz, ny, nx * ny, nx))
  pass(ny, nx, rows(nz, nx, nx * ny, 1))
  pass(nz, nx * ny, rows(ny, nx, nx, 1))
}

/**
 * The hollowed body without what cutting it left behind: specks, sealed voids (filled — a void
 * cannot be cast, and its metal is cheaper than a casting that fails), and crumbs — slivers of
 * a few cubic walls, and pieces left standing inside the cavity, which touch the outside
 * nowhere (every point deeper than half a wall). Consumes `m`.
 */
function withoutDebris(m: Manifold, grid: DistanceGrid, wall: number): Manifold {
  return keepPieces(m, (volume, largest, piece) => {
    if (volume < SPECK_VOLUME) return false
    // Slivers an escape hole shaves off a thin spike, a few cubic walls at most. A source mesh
    // brings no loose bits that small (repair removes them), so none of them is design.
    if (volume < CRUMB_WALLS * wall ** 3 && volume < CRUMB_SHARE * largest) return false
    const { positions: p } = trianglesFromManifold(piece)
    for (let v = 0; v < p.length; v += 3)
      if (sampleDistance(grid, p[v]!, p[v + 1]!, p[v + 2]!) < wall / 2) return true
    return false
  })
}

/** Where a hole's start cap and wall are probed: rings at these shares of its radius, 12 round. */
const DRAIN_RINGS = [0, 0.5, 1]
const DRAIN_PROBES = 12
/** The start cap sits this far inside the cavity, below the lowest point of its back face, mm. */
const DRAIN_CAP_INSET = 0.05
/** Spots tried per hole, spread over the half of the cavity's back face toward its end. */
const DRAIN_TRIES = 40
/** Metal kept between a hole and the outside, as a share of the wall (the cavity's own tolerance). */
const DRAIN_WALL_SHARE = 1 - 2 * CAVITY_TOLERANCE

/**
 * Escape holes along +Y from the highest and lowest back-facing points of one cavity, each out
 * through the first skin of `outer` (the body) it meets: on a crown or a ring, the far side of
 * the piece also lies toward the back, and a hole run on to the back plane would pierce it too.
 *
 * A hole is a Ø2 mm cylinder, so it reaches a millimetre either side of its axis. Its start cap
 * lies wholly inside the cavity, just under the cavity's back face across the whole disc: a cap
 * dug deeper, or overhanging the cavity's edge, ends in the metal beside the cavity and leaves a
 * skin a few hundredths thick under a pip or an edge, which breaks through in casting. A spot
 * where the hole would come closer than `wall` to the outside anywhere but where it leaves
 * through the back is passed over for the next one in toward the middle of the cavity.
 */
function drainHoles(
  cavity: Manifold,
  back: number,
  outer: TriangleBvh,
  wall: number,
): Manifold[] {
  const { manifold: mf } = runtime()
  const { positions: p, indices } = trianglesFromManifold(cavity)
  let top: [number, number, number] | null = null
  let bottom: [number, number, number] | null = null
  const backFaces: [number, number, number][] = []
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3
    const b = indices[t + 1]! * 3
    const c = indices[t + 2]! * 3
    const ux = p[b]! - p[a]!
    const uy = p[b + 1]! - p[a + 1]!
    const uz = p[b + 2]! - p[a + 2]!
    const vx = p[c]! - p[a]!
    const vy = p[c + 1]! - p[a + 1]!
    const vz = p[c + 2]! - p[a + 2]!
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    // Faces of the cavity that look toward the back wall.
    if (ny < 0.6 * Math.hypot(nx, ny, nz)) continue
    const centre: [number, number, number] = [
      (p[a]! + p[b]! + p[c]!) / 3,
      (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3,
      (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3,
    ]
    backFaces.push(centre)
    if (!top || centre[2] > top[2]) top = centre
    if (!bottom || centre[2] < bottom[2]) bottom = centre
  }
  if (!top || !bottom) return []
  const middleZ = (top[2] + bottom[2]) / 2
  const bvh = new TriangleBvh({ positions: p, indices })
  const above = Math.max(back, cavity.boundingBox().max[1]) + 1
  const hit: ClosestHit = { d2: 0, x: 0, y: 0, z: 0, triangle: -1 }
  const minMetal = wall * DRAIN_WALL_SHARE

  /** The cavity's spans along Y over (x, z), as [front, back] pairs, from the back down. */
  const spans = (x: number, z: number): [number, number][] => {
    const out: [number, number][] = []
    let depth = 0
    let enter = 0
    for (const c of bvh.crossings(x, above, z, 0, -1, 0)) {
      if (c.w > 0 && depth++ === 0) enter = above - c.t
      else if (c.w < 0 && --depth === 0) out.push([above - c.t, enter])
    }
    return out
  }
  const offsets: [number, number][] = DRAIN_RINGS.flatMap((share) =>
    share === 0
      ? [[0, 0] as [number, number]]
      : Array.from({ length: DRAIN_PROBES }, (_, k): [number, number] => {
          const a = (k / DRAIN_PROBES) * 2 * Math.PI
          return [share * DRAIN_RADIUS * Math.cos(a), share * DRAIN_RADIUS * Math.sin(a)]
        }),
  )

  /**
   * The hole on axis (x, z) out of the cavity span whose back face is nearest `near`: its start
   * and end along Y, or null when its disc does not fit inside the cavity or it would come
   * closer than the wall to the outside.
   */
  const fit = (x: number, z: number, near: number): { start: number; end: number } | null => {
    // The cavity's span over each probe, in the layer of the one over the axis. A probe off the
    // cavity's edge (a crown's point is a slit narrower than the hole) has none: the cap there
    // is in metal, which the wall check below measures.
    const columns: ([number, number] | null)[] = []
    for (const [dx, dz] of offsets) {
      const ref = columns[0]?.[1] ?? near
      const list = spans(x + dx, z + dz).filter(
        // Another layer of the cavity, or a back face steeper than 45° across the disc.
        (span) => Math.abs(span[1] - ref) <= DRAIN_RADIUS,
      )
      const span = list.length
        ? list.reduce((a, b) => (Math.abs(b[1] - ref) < Math.abs(a[1] - ref) ? b : a))
        : null
      if (!span && columns.length === 0) return null
      columns.push(span)
    }
    const inside = columns.filter((c): c is [number, number] => c !== null)
    const start = Math.min(...inside.map((c) => c[1])) - DRAIN_CAP_INSET
    // Where the hole leaves: the first skin above the cap, per probe.
    const exits = offsets.map(([dx, dz], k) => {
      const from = columns[k]?.[1] ?? start
      const up = outer.raycast(x + dx, from, z + dz, 0, 1, 0)
      return Number.isFinite(up) ? from + up : back
    })
    // The cap, and the wall up to a wall's depth under the skin it leaves through there.
    for (const [k, [dx, dz]] of offsets.entries()) {
      for (let y = start; y === start || y <= exits[k]! - wall; y += wall / 2) {
        if (outer.closest(x + dx, y, z + dz, hit, minMetal)) return null
        if (k === 0) break
      }
    }
    return { start, end: Math.min(back, Math.max(...exits)) + 1 }
  }

  /**
   * The first spot that takes a hole, trying back-facing points of the cavity from one end of
   * it toward its middle (`order` lists them from that end). The highest and lowest points are
   * best for the investment to run out, but on a crown the cavity there is a slit in a point
   * narrower than the hole, and the band lower down is where one fits.
   */
  const place = (order: readonly [number, number, number][], share: number) => {
    const step = Math.max(1, Math.floor((order.length * share) / DRAIN_TRIES))
    for (let k = 0; k < order.length * share; k += step) {
      const [x, y, z] = order[k]!
      const found = fit(x, z, y)
      if (found) return { x, z, ...found }
    }
    return null
  }

  const byHeight = [...backFaces].sort((a, b) => b[2] - a[2])
  const holes =
    top[2] - bottom[2] > 4 * DRAIN_RADIUS
      ? [place(byHeight, 0.5), place([...byHeight].reverse(), 0.5)]
      : [place([...byHeight].sort((a, b) => Math.abs(a[2] - middleZ) - Math.abs(b[2] - middleZ)), 1)]
  const kept = holes.filter((h): h is NonNullable<typeof h> => h !== null)
  // Two holes that met in the middle would overlap: one is enough there.
  if (
    kept.length === 2 &&
    Math.hypot(kept[0]!.x - kept[1]!.x, kept[0]!.z - kept[1]!.z) < 4 * DRAIN_RADIUS
  )
    kept.pop()
  return kept.map(({ x, z, start, end }) => {
    const cylinder = mf.Manifold.cylinder(end - start, DRAIN_RADIUS, DRAIN_RADIUS, 24)
    // Cylinder axis +Z → +Y, from inside the cavity out through the back.
    const turned = cylinder.rotate([-90, 0, 0])
    try {
      return turned.translate([x, start, z])
    } finally {
      cylinder.delete()
      turned.delete()
    }
  })
}
