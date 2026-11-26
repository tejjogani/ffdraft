/**
 * NURBS sweeps: a section profile carried through a sequence of stations.
 *
 * Nearly every piece of jewelry metal is one of these — a shank is a profile carried around the
 * finger, a prong a circle carried up a tapering path, a bezel a wall profile carried around a
 * stone's outline. A sweep is defined by its sections' Bézier control points; the surface is
 * cubic Bézier around each section and a C² interpolating cubic B-spline between sections.
 *
 * From that one definition this module produces, on demand:
 *  - the exact B-rep (one B-spline face per profile segment, sewn into a solid) for STEP and
 *    exact booleans, and
 *  - an analytic tessellation (watertight, with true surface normals) in about a millisecond,
 *    which is what interactive evaluation and STL use.
 * Both evaluate the same poles and knots, so they agree to the chord tolerance.
 */
import {
  assembleWire,
  type Face,
  makeBezierCurve,
  makeFace,
  makeSolid,
  type Shape3D,
  type Shell,
} from 'replicad'
import {
  lazySolid,
  type Quality,
  runtime,
  type Solid,
  type SolidRecipe,
  type SurfaceMesh,
} from '../core'
import { CREASE_ANGLE, meshVolume } from '../solid/meshing'
import { scoped, shapeVolume, wrapShape } from '../solid/occt'
import { type CubicSpline, chordParameters, cubicSpline } from './bspline'
import type { Loop } from './loop'
import type { Frame } from './vec'

export interface SweepSpec {
  /**
   * Control points of each section: `3 × segments` points (xyz) around the closed profile,
   * where segment s uses points 3s … 3s+3 (wrapping). All sections share the segment count.
   * A section whose points all coincide is a pole (a pointed or domed end).
   */
  sections: readonly Float64Array[]
  /** The sweep returns to its first section. */
  closed: boolean
  /** Section indices where the surface is creased across the sweep (corners of an outline). */
  kinks?: readonly number[]
  /** Optional cubic Bézier handles, one pair per two-section run between kinks. */
  bezierHandles?: readonly (readonly [Float64Array, Float64Array])[]
}

/** Places a 2D profile loop on a frame's xy-plane; x and y of the loop follow the frame's axes. */
export function placeLoop(frame: Frame, loop: Loop): Float64Array {
  const out = new Float64Array(loop.length * 9)
  loop.forEach((segment, s) => {
    for (let k = 0; k < 3; k++) {
      const [x, y] = segment[k]!
      const at = (s * 3 + k) * 3
      out[at] = frame.origin[0] + frame.x[0] * x + frame.y[0] * y
      out[at + 1] = frame.origin[1] + frame.x[1] * x + frame.y[1] * y
      out[at + 2] = frame.origin[2] + frame.x[2] * x + frame.y[2] * y
    }
  })
  return out
}

/** A pole section for `segments` profile segments: every control point at `point`. */
export function poleSection(
  point: readonly [number, number, number],
  segments: number,
): Float64Array {
  const out = new Float64Array(segments * 9)
  for (let i = 0; i < out.length; i += 3) out.set(point, i)
  return out
}

// ── Internal representation ──────────────────────────────────────────────────────────────────

/** A run of sections interpolated by one spline (the whole sweep unless it has kinks). */
interface Piece {
  /** Indices into `sections`, in order; a closed kinked piece ends on the next kink. */
  stations: number[]
  spline: CubicSpline
  /** `spline.poleCount` rows of `dim` numbers. */
  poles: Float64Array
}

interface Net {
  sections: readonly Float64Array[]
  profileRows: readonly Float64Array[]
  closed: boolean
  segments: number
  /** Numbers per section: 9 × segments. */
  dim: number
  pieces: Piece[]
  /** Pole flags of the first and last section (open sweeps only). */
  startPole: boolean
  endPole: boolean
}

function isPole(section: Float64Array): boolean {
  for (let i = 3; i < section.length; i++)
    if (Math.abs(section[i]! - section[i % 3]!) > 1e-9) return false
  return true
}

function buildNet(spec: SweepSpec): Net {
  const { sections, closed } = spec
  const dim = sections[0]?.length ?? 0
  if (sections.length < (closed ? 3 : 2) || dim === 0 || dim % 9 !== 0)
    throw new Error('A sweep needs at least two sections of 3 × segments control points')
  if (sections.some((s) => s.length !== dim))
    throw new Error('Sweep sections differ in segment count')
  const n = sections.length
  const kinks = [...new Set(spec.kinks ?? [])].filter((k) => k >= 0 && k < n).sort((a, b) => a - b)

  const runs: number[][] = []
  if (closed && kinks.length === 0) runs.push(Array.from({ length: n }, (_, i) => i))
  else if (closed)
    kinks.forEach((from, i) => {
      const to = kinks[(i + 1) % kinks.length]! + (i + 1 === kinks.length ? n : 0)
      runs.push(Array.from({ length: to - from + 1 }, (_, k) => (from + k) % n))
    })
  else {
    const breaks = [0, ...kinks.filter((k) => k > 0 && k < n - 1), n - 1]
    for (let i = 0; i + 1 < breaks.length; i++)
      runs.push(Array.from({ length: breaks[i + 1]! - breaks[i]! + 1 }, (_, k) => breaks[i]! + k))
  }

  const handles = spec.bezierHandles
  if (handles && (handles.length !== runs.length || runs.some((run) => run.length !== 2)))
    throw new Error('Bézier handles need one pair for each two-section sweep run')
  const pieces = runs.map((stations, i): Piece => {
    const periodic = closed && kinks.length === 0
    const points = new Float64Array(stations.length * dim)
    stations.forEach((index, row) => {
      points.set(sections[index]!, row * dim)
    })
    const spline = cubicSpline(chordParameters(points, dim, periodic), periodic)
    const pair = handles?.[i]
    if (pair) {
      const [a, b] = pair
      if (a.length !== dim || b.length !== dim)
        throw new Error('Bézier handles differ in segment count')
      const poles = new Float64Array(4 * dim)
      poles.set(sections[stations[0]!]!, 0)
      poles.set(a, dim)
      poles.set(b, 2 * dim)
      poles.set(sections[stations[1]!]!, 3 * dim)
      return { stations, spline, poles }
    }
    return { stations, spline, poles: spline.solve(points, dim) }
  })
  return {
    sections,
    profileRows: handles ? [...sections, ...handles.flat()] : sections,
    closed,
    segments: dim / 9,
    dim,
    pieces,
    startPole: !closed && isPole(sections[0]!),
    endPole: !closed && isPole(sections[n - 1]!),
  }
}

/** Section control points and their derivative along the sweep at parameter `u` of a piece. */
function evaluateRow(
  net: Net,
  piece: Piece,
  u: number,
  row: Float64Array,
  tangent: Float64Array,
): void {
  const basis = piece.spline.basisAt(u)
  const { dim } = net
  const count = piece.spline.poleCount
  row.fill(0)
  tangent.fill(0)
  for (let i = 0; i < 4; i++) {
    const base = (piece.spline.periodic ? (basis.first + i) % count : basis.first + i) * dim
    const w = basis.w[i]!
    const dw = basis.dw[i]!
    if (w === 0 && dw === 0) continue
    for (let c = 0; c < dim; c++) {
      const p = piece.poles[base + c]!
      row[c]! += w * p
      tangent[c]! += dw * p
    }
  }
}

// ── Sampling density ─────────────────────────────────────────────────────────────────────────

/** Subdivisions that keep a curve span with mid-chord deviation `sag` over chord `length` in tolerance. */
function subdivisions(
  sag: number,
  length: number,
  quality: Quality,
  refine: number,
  max: number,
): number {
  if (sag < 1e-7) return refine
  const byChord = Math.sqrt(sag / quality.chord)
  // A circular arc with sagitta s over chord L turns through ≈ 8·s/L radians.
  const byAngle = length > 1e-9 ? (8 * sag) / length / quality.angle : 0
  return Math.min(max, Math.max(1, Math.ceil(Math.max(byChord, byAngle)))) * refine
}

/** Largest 3D distance between corresponding control points of two rows, and its chord. */
function rowDeviation(
  a: Float64Array,
  b: Float64Array,
  mid: Float64Array,
): { sag: number; length: number } {
  let sag = 0
  let length = 0
  for (let c = 0; c < a.length; c += 3) {
    const d = Math.hypot(
      mid[c]! - (a[c]! + b[c]!) / 2,
      mid[c + 1]! - (a[c + 1]! + b[c + 1]!) / 2,
      mid[c + 2]! - (a[c + 2]! + b[c + 2]!) / 2,
    )
    if (d > sag) {
      sag = d
      length = Math.hypot(a[c]! - b[c]!, a[c + 1]! - b[c + 1]!, a[c + 2]! - b[c + 2]!)
    }
  }
  return { sag, length }
}

/** How many samples each profile segment needs, from the flatness of its control polygon. */
function segmentCounts(net: Net, quality: Quality, refine: number): number[] {
  const counts = new Array<number>(net.segments).fill(refine)
  for (const section of net.profileRows)
    for (let s = 0; s < net.segments; s++) {
      const p = (k: number, c: number) => section[((s * 3 + k) % (net.segments * 3)) * 3 + c]!
      let sag = 0
      for (const [k, wa, wb] of [
        [1, 2 / 3, 1 / 3],
        [2, 1 / 3, 2 / 3],
      ] as const)
        sag = Math.max(
          sag,
          Math.hypot(
            p(k, 0) - wa * p(0, 0) - wb * p(3, 0),
            p(k, 1) - wa * p(0, 1) - wb * p(3, 1),
            p(k, 2) - wa * p(0, 2) - wb * p(3, 2),
          ) * 0.75,
        )
      const length = Math.hypot(p(3, 0) - p(0, 0), p(3, 1) - p(0, 1), p(3, 2) - p(0, 2))
      counts[s] = Math.max(counts[s]!, subdivisions(sag, length, quality, refine, 32))
    }
  return counts
}

// ── Tessellation ─────────────────────────────────────────────────────────────────────────────

interface SampleRow {
  piece: Piece
  u: number
}

/** The u-samples of every piece: each span is subdivided to tolerance; the end row is excluded. */
function sampleRows(net: Net, quality: Quality, refine: number): SampleRow[][] {
  const a = new Float64Array(net.dim)
  const b = new Float64Array(net.dim)
  const mid = new Float64Array(net.dim)
  const scratch = new Float64Array(net.dim)
  return net.pieces.map((piece) => {
    const rows: SampleRow[] = []
    const knots = piece.spline.knots
    for (let j = 0; j + 1 < knots.length; j++) {
      const u0 = knots[j]!
      const u1 = knots[j + 1]!
      evaluateRow(net, piece, u0, a, scratch)
      evaluateRow(net, piece, u1 - (u1 - u0) * 1e-9, b, scratch)
      evaluateRow(net, piece, (u0 + u1) / 2, mid, scratch)
      const { sag, length } = rowDeviation(a, b, mid)
      const n = subdivisions(sag, length, quality, refine, 64)
      for (let m = 0; m < n; m++) rows.push({ piece, u: u0 + ((u1 - u0) * m) / n })
    }
    return rows
  })
}

/** Evaluates Bézier segment `s` of a row at `t`: writes position (and tangent across the profile). */
function evaluateSegment(
  row: Float64Array,
  ctrl: number,
  s: number,
  t: number,
  out: Float64Array,
  at: number,
  derivative: boolean,
): void {
  const i0 = s * 9
  const i1 = i0 + 3
  const i2 = i0 + 6
  const i3 = (((s + 1) * 3) % ctrl) * 3
  const u = 1 - t
  const w0 = derivative ? -3 * u * u : u * u * u
  const w1 = derivative ? 3 * u * u - 6 * u * t : 3 * u * u * t
  const w2 = derivative ? 6 * u * t - 3 * t * t : 3 * u * t * t
  const w3 = derivative ? 3 * t * t : t * t * t
  for (let c = 0; c < 3; c++)
    out[at + c] = w0 * row[i0 + c]! + w1 * row[i1 + c]! + w2 * row[i2 + c]! + w3 * row[i3 + c]!
}

function tessellate(net: Net, quality: Quality, refine = 1): SurfaceMesh {
  const { segments, dim, closed } = net
  const ctrl = segments * 3
  const counts = segmentCounts(net, quality, refine)
  const around = counts.reduce((a, b) => a + b, 0)
  const perPiece = sampleRows(net, quality, refine)
  const rows = perPiece.flat()
  // Open sweeps end on one more row: the last section itself.
  const last = net.pieces[net.pieces.length - 1]!
  if (!closed) rows.push({ piece: last, u: last.spline.knots[last.spline.knots.length - 1]! })
  const rowCount = rows.length

  // Welded vertices: `around` per row, a single one for pole rows, plus cap centres.
  const poleRow = (r: number) => (r === 0 && net.startPole) || (r === rowCount - 1 && net.endPole)
  const offsets = new Uint32Array(rowCount + 1)
  for (let r = 0; r < rowCount; r++) offsets[r + 1] = offsets[r]! + (poleRow(r) ? 1 : around)
  const capStart = !closed && !net.startPole
  const capEnd = !closed && !net.endPole
  const vertexCount = offsets[rowCount]! + (capStart ? 1 : 0) + (capEnd ? 1 : 0)
  const positions = new Float32Array(vertexCount * 3)

  // Display vertices are per (row, profile sample) with segment ends duplicated, so creases
  // between profile segments and across kinks keep distinct normals.
  const displayAround = around + segments
  const displayPositions: number[] = []
  const displayNormals: number[] = []
  const displayIndices: number[] = []

  const row = new Float64Array(dim)
  const tangent = new Float64Array(dim)
  const p = new Float64Array(3)
  const dv = new Float64Array(3)
  const du = new Float64Array(3)
  const vertex = (r: number, b: number) => offsets[r]! + (poleRow(r) ? 0 : b % around)

  /** Fills welded positions of row `r` and appends its display vertices. */
  const emitRow = (r: number, piece: Piece, u: number, weld: boolean) => {
    evaluateRow(net, piece, u, row, tangent)
    let b = 0
    for (let s = 0; s < segments; s++) {
      const n = counts[s]!
      for (let m = 0; m <= n; m++) {
        const t = m / n
        evaluateSegment(row, ctrl, s, t, p, 0, false)
        evaluateSegment(row, ctrl, s, t, dv, 0, true)
        evaluateSegment(tangent, ctrl, s, t, du, 0, false)
        if (weld && m < n) positions.set(p, vertex(r, b + m) * 3)
        // Outward normal for a counter-clockwise profile travelling along +u.
        let nx = dv[1]! * du[2]! - dv[2]! * du[1]!
        let ny = dv[2]! * du[0]! - dv[0]! * du[2]!
        let nz = dv[0]! * du[1]! - dv[1]! * du[0]!
        const l = Math.hypot(nx, ny, nz)
        if (l > 1e-12) {
          nx /= l
          ny /= l
          nz /= l
        }
        displayPositions.push(p[0]!, p[1]!, p[2]!)
        displayNormals.push(nx, ny, nz)
      }
      b += n
    }
  }

  const indices: number[] = []
  const quad = (a: number, b: number, c: number, d: number, into: number[]) => {
    if (a !== b && b !== c && a !== c) into.push(a, b, c)
    if (a !== c && c !== d && a !== d) into.push(a, c, d)
  }

  /** Display rows of each piece: index of the first vertex and the number of rows. */
  const displayPieces: { base: number; rows: number }[] = []
  let r = 0
  net.pieces.forEach((piece, pi) => {
    const samples = perPiece[pi]!
    const base = displayPositions.length / 3
    displayPieces.push({ base, rows: samples.length + 1 })
    const knots = piece.spline.knots
    const endU = knots[knots.length - 1]!
    samples.forEach((sample, k) => {
      emitRow(r + k, piece, sample.u, true)
    })
    // The piece's closing row: welded only when it is the open sweep's final row.
    const closing = (r + samples.length) % (closed ? rowCount : rowCount + 1)
    const isFinal = !closed && pi === net.pieces.length - 1
    emitRow(closing, piece, endU, isFinal)
    for (let k = 0; k < samples.length; k++) {
      const r0 = r + k
      const r1 = closed ? (r0 + 1) % rowCount : r0 + 1
      let b = 0
      for (let s = 0; s < segments; s++) {
        for (let m = 0; m < counts[s]!; m++) {
          quad(
            vertex(r0, b + m),
            vertex(r0, b + m + 1),
            vertex(r1, b + m + 1),
            vertex(r1, b + m),
            indices,
          )
          const d0 = base + k * displayAround + b + s + m
          const d1 = d0 + displayAround
          const degenerate0 = poleRow(r0)
          const degenerate1 = poleRow(r1)
          if (!degenerate0) displayIndices.push(d0, d0 + 1, d1 + 1)
          if (!degenerate1) displayIndices.push(d0, d1 + 1, d1)
        }
        b += counts[s]!
      }
    }
    r += samples.length
  })

  // A smooth pole shares one normal: the mean of the ring next to it.
  const smoothPole = (firstDisplayRow: number, neighbour: number) => {
    let nx = 0
    let ny = 0
    let nz = 0
    for (let i = 0; i < displayAround; i++) {
      nx += displayNormals[(neighbour + i) * 3]!
      ny += displayNormals[(neighbour + i) * 3 + 1]!
      nz += displayNormals[(neighbour + i) * 3 + 2]!
    }
    const l = Math.hypot(nx, ny, nz) || 1
    for (let i = 0; i < displayAround; i++) {
      displayNormals[(firstDisplayRow + i) * 3] = nx / l
      displayNormals[(firstDisplayRow + i) * 3 + 1] = ny / l
      displayNormals[(firstDisplayRow + i) * 3 + 2] = nz / l
    }
  }
  const displayRows = displayPositions.length / 3 / displayAround
  if (net.startPole) smoothPole(0, displayAround)
  if (net.endPole) smoothPole((displayRows - 1) * displayAround, (displayRows - 2) * displayAround)

  // Feature edges come from the construction, not from the triangles: profile joints and kinks
  // where the surface normal really breaks, and the rims of flat caps.
  const edges: number[] = []
  const cosCrease = Math.cos(CREASE_ANGLE)
  const creased = (a: number, b: number): boolean =>
    displayNormals[a * 3]! * displayNormals[b * 3]! +
      displayNormals[a * 3 + 1]! * displayNormals[b * 3 + 1]! +
      displayNormals[a * 3 + 2]! * displayNormals[b * 3 + 2]! <
    cosCrease
  const segmentTo = (a: number, b: number) => {
    for (const v of [a, b])
      edges.push(
        displayPositions[v * 3]!,
        displayPositions[v * 3 + 1]!,
        displayPositions[v * 3 + 2]!,
      )
  }
  // Offset of each profile segment's first display vertex within a row.
  const starts: number[] = []
  counts.reduce((offset, n, i) => {
    starts[i] = offset + i
    return offset + n
  }, 0)
  displayPieces.forEach(({ base, rows }, pi) => {
    for (let seg = 0; seg < segments; seg++) {
      const end = starts[seg]! + counts[seg]!
      const next = starts[(seg + 1) % segments]!
      for (let k = 0; k + 1 < rows; k++) {
        const a = base + k * displayAround
        const b = a + displayAround
        if (creased(a + end, a + next) && creased(b + end, b + next)) segmentTo(a + end, b + end)
      }
    }
    // The seam to the next piece (a kink): creased wherever the two pieces' normals differ.
    const following = closed
      ? displayPieces[(pi + 1) % displayPieces.length]
      : displayPieces[pi + 1]
    if (!following || (closed && net.pieces.length === 1)) return
    const mine = base + (rows - 1) * displayAround
    for (let seg = 0; seg < segments; seg++)
      for (let m = 0; m < counts[seg]!; m++) {
        const i = starts[seg]! + m
        if (creased(mine + i, following.base + i) && creased(mine + i + 1, following.base + i + 1))
          segmentTo(mine + i, mine + i + 1)
      }
  })

  // Flat caps: a fan about the centroid of the end profile.
  const cap = (rowIndex: number, centre: number, outwardAlongSweep: boolean) => {
    let cx = 0
    let cy = 0
    let cz = 0
    for (let b = 0; b < around; b++) {
      const v = vertex(rowIndex, b) * 3
      cx += positions[v]!
      cy += positions[v + 1]!
      cz += positions[v + 2]!
    }
    positions.set([cx / around, cy / around, cz / around], centre * 3)
    const start = displayPositions.length / 3
    const first = indices.length
    for (let b = 0; b < around; b++) {
      const v0 = vertex(rowIndex, b)
      const v1 = vertex(rowIndex, b + 1)
      if (outwardAlongSweep) indices.push(centre, v0, v1)
      else indices.push(centre, v1, v0)
      for (const v of [v0, v1])
        edges.push(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!)
    }
    // Display: the same triangles with one flat normal.
    const i0 = indices[first]! * 3
    const i1 = indices[first + 1]! * 3
    const i2 = indices[first + 2]! * 3
    const ux = positions[i1]! - positions[i0]!
    const uy = positions[i1 + 1]! - positions[i0 + 1]!
    const uz = positions[i1 + 2]! - positions[i0 + 2]!
    const vx = positions[i2]! - positions[i0]!
    const vy = positions[i2 + 1]! - positions[i0 + 1]!
    const vz = positions[i2 + 2]! - positions[i0 + 2]!
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    nx /= l
    ny /= l
    nz /= l
    const local = new Map<number, number>()
    for (let i = first; i < indices.length; i++) {
      const v = indices[i]!
      let d = local.get(v)
      if (d === undefined) {
        d = start + local.size
        local.set(v, d)
        displayPositions.push(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!)
        displayNormals.push(nx, ny, nz)
      }
      displayIndices.push(d)
    }
  }
  if (capStart) cap(0, offsets[rowCount]!, false)
  if (capEnd) cap(rowCount - 1, offsets[rowCount]! + (capStart ? 1 : 0), true)

  const welded = { positions, indices: new Uint32Array(indices) }
  const display = {
    positions: new Float32Array(displayPositions),
    normals: new Float32Array(displayNormals),
    indices: new Uint32Array(displayIndices),
  }
  // The construction assumes a counter-clockwise profile seen against the travel direction;
  // if the caller's handedness is the other way round the surface is inside out — flip it.
  if (meshVolume(welded) < 0) {
    flipWinding(welded.indices)
    flipWinding(display.indices)
    for (let i = 0; i < display.normals.length; i++) display.normals[i] = -display.normals[i]!
  }
  return { ...welded, display: { mesh: display, edges: new Float32Array(edges) } }
}

function flipWinding(indices: Uint32Array): void {
  for (let i = 0; i < indices.length; i += 3) {
    const t = indices[i + 1]!
    indices[i + 1] = indices[i + 2]!
    indices[i + 2] = t
  }
}

// ── Exact volume ─────────────────────────────────────────────────────────────────────────────

/** Five-point Gauss–Legendre nodes and weights on [0, 1]: exact for polynomials up to degree 9. */
const GAUSS = [
  [0.046910077030668, 0.118463442528095],
  [0.230765344947158, 0.239314335249683],
  [0.5, 0.284444444444444],
  [0.769234655052842, 0.239314335249683],
  [0.953089922969332, 0.118463442528095],
] as const

/**
 * Volume enclosed by the sweep, from the divergence theorem V = ⅓∮ S·n dA. On every knot span
 * the integrand S·(S_v × S_u) is a polynomial of degree 8 in both parameters, so Gauss
 * quadrature integrates the exact NURBS surface — no B-rep and no tessellation error.
 */
function exactVolume(net: Net): number {
  const { segments, dim } = net
  const ctrl = segments * 3
  const row = new Float64Array(dim)
  const tangent = new Float64Array(dim)
  const p = new Float64Array(3)
  const dv = new Float64Array(3)
  const du = new Float64Array(3)
  let sum = 0
  for (const piece of net.pieces) {
    const knots = piece.spline.knots
    for (let j = 0; j + 1 < knots.length; j++) {
      const span = knots[j + 1]! - knots[j]!
      for (const [gu, wu] of GAUSS) {
        evaluateRow(net, piece, knots[j]! + span * gu, row, tangent)
        for (let s = 0; s < segments; s++)
          for (const [gv, wv] of GAUSS) {
            evaluateSegment(row, ctrl, s, gv, p, 0, false)
            evaluateSegment(row, ctrl, s, gv, dv, 0, true)
            evaluateSegment(tangent, ctrl, s, gv, du, 0, false)
            sum +=
              wu * wv * span *
              (p[0]! * (dv[1]! * du[2]! - dv[2]! * du[1]!) +
                p[1]! * (dv[2]! * du[0]! - dv[0]! * du[2]!) +
                p[2]! * (dv[0]! * du[1]! - dv[1]! * du[0]!))
          } // biome-ignore format: the triple product reads best aligned
      }
    }
  }
  // Flat caps: ⅓(c·n)A, with the vector area ½∮ p × dp integrated along the profile.
  const cap = (section: Float64Array, sign: number) => {
    for (let s = 0; s < segments; s++)
      for (const [g, w] of GAUSS) {
        evaluateSegment(section, ctrl, s, g, p, 0, false)
        evaluateSegment(section, ctrl, s, g, dv, 0, true)
        // p·(p × dp) vanishes, so take the moment about the section's first control point.
        const ox = p[0]! - section[0]!
        const oy = p[1]! - section[1]!
        const oz = p[2]! - section[2]!
        sum +=
          sign * w * 0.5 *
          (section[0]! * (oy * dv[2]! - oz * dv[1]!) +
            section[1]! * (oz * dv[0]! - ox * dv[2]!) +
            section[2]! * (ox * dv[1]! - oy * dv[0]!))
      } // biome-ignore format: the triple product reads best aligned
  }
  if (!net.closed && !net.startPole) cap(net.sections[0]!, -1)
  if (!net.closed && !net.endPole) cap(net.sections[net.sections.length - 1]!, 1)
  return Math.abs(sum) / 3
}

// ── Exact B-rep ──────────────────────────────────────────────────────────────────────────────

/** Sewing tolerance: faces are built from shared control points, so gaps are round-off only. */
const SEW_TOLERANCE = 1e-5

function buildBrep(net: Net): Shape3D {
  const { oc } = runtime()
  const { segments, dim } = net
  const ctrl = segments * 3
  const faces: (Face | Shell)[] = []
  try {
    for (const piece of net.pieces) {
      const count = piece.spline.poleCount
      for (let s = 0; s < segments; s++) {
        const face = scoped((own) => {
          const poles = own(new oc.NCollection_Array2_gp_Pnt(1, count, 1, 4))
          for (let i = 0; i < count; i++)
            for (let k = 0; k < 4; k++) {
              const at = i * dim + ((s * 3 + k) % ctrl) * 3
              const point = own(
                new oc.gp_Pnt(piece.poles[at]!, piece.poles[at + 1]!, piece.poles[at + 2]!),
              )
              poles.SetValue(i + 1, k + 1, point)
            }
          const knots = piece.spline.knots
          const uKnots = own(new oc.NCollection_Array1_double(1, knots.length))
          const uMults = own(new oc.NCollection_Array1_int(1, knots.length))
          knots.forEach((knot, i) => {
            uKnots.SetValue(i + 1, knot)
            uMults.SetValue(i + 1, piece.spline.multiplicities[i]!)
          })
          const vKnots = own(new oc.NCollection_Array1_double(1, 2))
          const vMults = own(new oc.NCollection_Array1_int(1, 2))
          vKnots.SetValue(1, 0)
          vKnots.SetValue(2, 1)
          vMults.SetValue(1, 4)
          vMults.SetValue(2, 4)
          const surface = own(
            new oc.Geom_BSplineSurface(
              poles,
              uKnots,
              vKnots,
              uMults,
              vMults,
              3,
              3,
              piece.spline.periodic,
              false,
            ),
          )
          // The face keeps its own handle to the surface; 1e-6 lets pole edges be degenerate.
          const maker = own(new oc.BRepBuilderAPI_MakeFace(surface, 1e-6))
          return wrapShape<Face>(maker.Face())
        })
        faces.push(face)
      }
    }
    const capFace = (section: Float64Array): Face => {
      const edges = Array.from({ length: segments }, (_, s) =>
        makeBezierCurve(
          [0, 1, 2, 3].map((k) => {
            const at = ((s * 3 + k) % ctrl) * 3
            return [section[at]!, section[at + 1]!, section[at + 2]!] as [number, number, number]
          }),
        ),
      )
      const wire = assembleWire(edges)
      try {
        return makeFace(wire)
      } finally {
        wire.delete()
        for (const e of edges) e.delete()
      }
    }
    if (!net.closed && !net.startPole) faces.push(capFace(net.sections[0]!))
    if (!net.closed && !net.endPole) faces.push(capFace(net.sections[net.sections.length - 1]!))

    const sewn = scoped((own) => {
      const sewing = own(new oc.BRepBuilderAPI_Sewing(SEW_TOLERANCE, true, true, true, false))
      for (const f of faces) sewing.Add(f.wrapped)
      sewing.Perform()
      return wrapShape<Shell>(sewing.SewedShape())
    })
    try {
      const solid = makeSolid([sewn])
      if (shapeVolume(solid) >= 0) return solid
      // Inside-out shell (see the winding note in `tessellate`): reverse it.
      const reversed = wrapShape<Shape3D>(solid.wrapped.Reversed())
      solid.delete()
      return reversed
    } finally {
      sewn.delete()
    }
  } finally {
    for (const f of faces) f.delete()
  }
}

// ── Public ───────────────────────────────────────────────────────────────────────────────────

/** The on-demand producers of a sweep, for callers that substitute one of them. */
export function sweepRecipe(
  spec: SweepSpec,
): Required<Pick<SolidRecipe, 'brep' | 'mesh' | 'volume'>> {
  const net = buildNet(spec)
  return {
    brep: () => buildBrep(net),
    mesh: (quality) => tessellate(net, quality),
    volume: () => exactVolume(net),
  }
}

/** A swept solid: exact B-rep on demand, analytic mesh for everything interactive. */
export const sweepSolid = (spec: SweepSpec): Solid => lazySolid(sweepRecipe(spec))
