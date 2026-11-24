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
      const holes = drainHoles(piece, back, outer)
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

/**
 * Escape holes along +Y from the highest and lowest back-facing points of one cavity, each out
 * through the first skin of `outer` (the body) it meets: on a crown or a ring, the far side of
 * the piece also lies toward the back, and a hole run on to the back plane would pierce it too.
 */
function drainHoles(cavity: Manifold, back: number, outer: TriangleBvh): Manifold[] {
  const { manifold: mf } = runtime()
  const { positions: p, indices } = trianglesFromManifold(cavity)
  let top: [number, number, number] | null = null
  let bottom: [number, number, number] | null = null
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
    if (!top || centre[2] > top[2]) top = centre
    if (!bottom || centre[2] < bottom[2]) bottom = centre
  }
  if (!top || !bottom) return []
  // Each hole is inset by its radius toward the middle so its rim stays over the cavity.
  const spots: [number, number, number][] =
    top[2] - bottom[2] > 4 * DRAIN_RADIUS
      ? [
          [top[0], top[1], top[2] - DRAIN_RADIUS],
          [bottom[0], bottom[1], bottom[2] + DRAIN_RADIUS],
        ]
      : [[top[0], top[1], (top[2] + bottom[2]) / 2]]
  const bvh = new TriangleBvh({ positions: p, indices })
  return spots.map(([x, y, z]) => {
    // The hole starts inside the cavity, but no deeper than half way across it: where the
    // cavity is a thin sheet, a hole starting a full diameter in digs into the front wall
    // from inside and leaves it a tenth of a millimetre thick.
    const across = bvh.raycast(x, y + 1e-3, z, 0, -1, 0, 2e-3)
    const start = y - Math.min(2 * DRAIN_RADIUS, across / 2)
    const exit = outer.raycast(x, y, z, 0, 1, 0)
    const end = Number.isFinite(exit) ? Math.min(back, y + exit) + 1 : back + 1
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
