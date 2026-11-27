import { MAX_RHINO_FACE_BORDER_PAGE_SIZE } from '@pave/schema'
import type { BrepEdgeList, BrepFace, BrepVertexList, NurbsCurve, RhinoModule } from 'rhino3dm'
import { type PlacedRhinoCurve, RhinoCurveReadError, readPlacedCurve } from './rhino-curve'
import {
  type HoldRhino,
  type RhinoPlacement,
  type RhinoPoint,
  readRetainedRhinoSolid,
  rhinoPlacement,
  withRhinoHandles,
} from './rhino-solid'

type LoopKind = 'outer' | 'inner'
type BorderCurve = Pick<PlacedRhinoCurve, 'degree' | 'knots' | 'controlPoints'> & { kind: LoopKind }
interface BorderFace {
  faceIndex: number
  loops: { kind: LoopKind; preview: RhinoPoint[] }[]
}
interface FaceBorderInspection {
  faceCount: number
  faces: BorderFace[]
  curves?: BorderCurve[]
  reason: string | null
}
interface FaceBorderRequest extends RhinoPlacement {
  faceIndex?: number
  offset?: number
  limit?: number
}
interface Trim {
  edgeIndex: number
  start: number
  end: number
  reversed: boolean
}
interface Loop {
  kind: LoopKind
  trims: Trim[]
}

const MAX_EDGES_PER_LOOP = 64
const MAX_LOOPS_PER_FACE = 12
const MAX_EDGES_PER_FACE = 192
const PREVIEW_SEGMENTS = 96
const JOIN_TOLERANCE_MM = 1e-7

class UnsupportedBorder extends Error {}

function readLoops(rhino: RhinoModule, face: BrepFace, hold: HoldRhino): Loop[] {
  const types = (rhino as RhinoModule & { BrepLoopType: { Outer: number; Inner: number } })
    .BrepLoopType
  const loops = hold(face.loops)
  if (loops.count === 0 || loops.count > MAX_LOOPS_PER_FACE)
    throw new UnsupportedBorder('This face has no simple border within the loop limit.')
  const result: Loop[] = []
  const seenEdges = new Set<number>()
  const seenVertices = new Set<number>()
  for (let i = 0; i < loops.count; i++) {
    const loop = hold(loops.get(i))
    const kind =
      loop.loopType === types.Outer ? 'outer' : loop.loopType === types.Inner ? 'inner' : null
    const trims = hold(loop.trims)
    if (!kind || trims.count === 0 || trims.count > MAX_EDGES_PER_LOOP)
      throw new UnsupportedBorder(
        'This face has a trim loop outside the supported border geometry.',
      )
    const cycle: Trim[] = []
    for (let j = 0; j < trims.count; j++) {
      const trim = hold(trims.get(j))
      const edgeIndex = trim.edgeIndex
      if (edgeIndex < 0) throw new UnsupportedBorder('This face contains a trim without a 3D edge.')
      if (seenEdges.has(edgeIndex))
        throw new UnsupportedBorder('This face has a seam or repeated trim edge.')
      const start = trim.startVertexIndex
      const end = trim.endVertexIndex
      if (start < 0 || end < 0 || seenVertices.has(start))
        throw new UnsupportedBorder('This face has a repeated or missing border vertex.')
      seenEdges.add(edgeIndex)
      seenVertices.add(start)
      cycle.push({ edgeIndex, start, end, reversed: trim.isReversed })
    }
    if (cycle.some((trim, j) => trim.end !== cycle[(j + 1) % cycle.length]!.start))
      throw new UnsupportedBorder('This face has a discontinuous trim cycle.')
    result.push({ kind, trims: cycle })
  }
  const outer = result.filter(({ kind }) => kind === 'outer')
  if (outer.length !== 1 || seenEdges.size > MAX_EDGES_PER_FACE)
    throw new UnsupportedBorder('This face needs one simple outer border within the edge limit.')
  return [...outer, ...result.filter(({ kind }) => kind === 'inner')]
}

type Place = (p: readonly number[]) => RhinoPoint
const gap = (a: RhinoPoint, b: RhinoPoint) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function readBorder(
  rhino: RhinoModule,
  edges: BrepEdgeList,
  vertices: BrepVertexList,
  loop: Loop,
  flip: boolean,
  place: Place,
  hold: HoldRhino,
): { curve: BorderCurve; preview: RhinoPoint[] } {
  const trims = flip ? [...loop.trims].reverse() : loop.trims
  const segments: NurbsCurve[] = []
  for (const trim of trims) {
    const start = flip ? trim.end : trim.start
    const end = flip ? trim.start : trim.end
    if (trim.edgeIndex >= edges.count || start >= vertices.count || end >= vertices.count)
      throw new UnsupportedBorder('This face has an invalid native border reference.')
    const edge = hold(edges.get(trim.edgeIndex))
    const segment = hold(edge.toNurbsCurve())
    if (!segment?.isValid || (trim.reversed !== flip && !segment.reverse()))
      throw new UnsupportedBorder('A face edge cannot be copied as an exact NURBS segment.')
    if (
      gap(place(segment.pointAtStart), place(hold(vertices.get(start)).location)) >
        JOIN_TOLERANCE_MM ||
      gap(place(segment.pointAtEnd), place(hold(vertices.get(end)).location)) > JOIN_TOLERANCE_MM
    )
      throw new UnsupportedBorder('This face has a geometric gap in its native border.')
    segments.push(segment)
  }

  const samples: RhinoPoint[] = []
  let joined = segments[0]!
  if (segments.length > 1) {
    const poly = hold(new rhino.PolyCurve())
    for (const [index, segment] of segments.entries()) {
      const next = segments[(index + 1) % segments.length]!
      if (
        gap(place(segment.pointAtEnd), place(next.pointAtStart)) > JOIN_TOLERANCE_MM ||
        !poly.appendSegment(segment)
      )
        throw new UnsupportedBorder('This face has a geometric gap in its native border.')
    }
    if (poly.hasGap)
      throw new UnsupportedBorder('This face has a geometric gap in its native border.')
    joined = hold(poly.toNurbsCurve())
    if (!joined?.isValid || !joined.isClosed)
      throw new UnsupportedBorder('The face border cannot form one exact closed NURBS curve.')
    // Each source segment is already NURBS. OpenNURBS joins those spans exactly; verify their
    // interior locus in project coordinates before exposing the standalone curve.
    for (const [index, segment] of segments.entries()) {
      const [first, last] = segment.domain as [number, number]
      for (const fraction of [0.17, 0.5, 0.83]) {
        const t = first + (last - first) * fraction
        const joinedT = poly.polyCurveParameter(index, t)
        if (gap(place(segment.pointAt(t)), place(joined.pointAt(joinedT))) > JOIN_TOLERANCE_MM)
          throw new UnsupportedBorder('Rhino could not preserve the exact face border.')
      }
    }
  }
  if (!joined.isClosed)
    throw new UnsupportedBorder('This face has a geometric gap in its native border.')

  for (const segment of segments) {
    const [first, last] = segment.domain as [number, number]
    const straight = segment.degree === 1 && segment.spanCount === 1
    const count = straight ? 1 : Math.min(32, Math.floor(PREVIEW_SEGMENTS / segments.length))
    for (let i = 0; i < count; i++)
      samples.push(place(segment.pointAt(first + ((last - first) * i) / count)))
  }
  samples.push(samples[0]!)
  const { degree, knots, controlPoints } = readPlacedCurve(rhino, joined, place)
  return { curve: { kind: loop.kind, degree, knots, controlPoints }, preview: samples }
}

/** Read complete, simple native face borders. An exact request returns one curve per loop. */
export async function listRhinoFaceBorders(
  nativeBytes: Uint8Array,
  request: FaceBorderRequest = {},
): Promise<FaceBorderInspection> {
  const { offset = 0, limit = 20, faceIndex } = request
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_RHINO_FACE_BORDER_PAGE_SIZE
  )
    throw new Error('The Rhino face page is outside the supported range.')
  if (faceIndex !== undefined && (!Number.isSafeInteger(faceIndex) || faceIndex < 0))
    throw new Error('The Rhino face index is invalid.')
  const { place, reflected } = rhinoPlacement(request)
  const result = await readRetainedRhinoSolid<FaceBorderInspection>(
    nativeBytes,
    (rhino, part, hold) => {
      const faces = hold(part.faces())
      const edges = hold(part.edges())
      const vertices = hold(part.vertices())
      const faceCount = faces.count
      if (faceIndex !== undefined && faceIndex >= faceCount)
        throw new Error('Choose an existing face on this Rhino solid.')
      const page: BorderFace[] = []
      const start = faceIndex ?? offset
      const stop = faceIndex === undefined ? Math.min(faceCount, offset + limit) : faceIndex + 1
      for (let i = start; i < stop; i++) {
        try {
          const borders = withRhinoHandles((holdFace) => {
            const face = holdFace(faces.get(i))
            const flip = face.orientationIsReversed !== reflected
            return readLoops(rhino, face, holdFace).map((loop) =>
              readBorder(rhino, edges, vertices, loop, flip, place, holdFace),
            )
          })
          const summary = {
            faceIndex: i,
            loops: borders.map(({ curve, preview }) => ({ kind: curve.kind, preview })),
          }
          if (faceIndex !== undefined)
            return {
              faceCount,
              faces: [summary],
              curves: borders.map(({ curve }) => curve),
              reason: null,
            }
          page.push(summary)
        } catch (error) {
          if (!(error instanceof UnsupportedBorder || error instanceof RhinoCurveReadError))
            throw error
          if (faceIndex !== undefined) return { faceCount, faces: [], reason: error.message }
        }
      }
      return { faceCount, faces: page, reason: null }
    },
  )
  return (
    result ?? {
      faceCount: 0,
      faces: [],
      reason: 'The Rhino source does not contain a valid retained solid.',
    }
  )
}
