import { MAX_RHINO_EDGE_PAGE_SIZE } from '@pave/schema'
import type { BrepEdge } from 'rhino3dm'
import {
  composeTransform,
  cross,
  dot,
  IDENTITY,
  length,
  type Mat4,
  multiply,
  scale,
  transformPoint,
  type Vec3,
} from '../geometry/vec'
import { freeRhino, loadRhino3dm } from '../runtime/rhino'
import { MAX_RHINO_FILE_BYTES } from './rhino'
import { type PlacedRhinoCurve, readPlacedCurve } from './rhino-curve'

type Point = [number, number, number]
type EdgeCurve = Pick<PlacedRhinoCurve, 'degree' | 'knots' | 'controlPoints'>

interface EdgePreview {
  edgeIndex: number
  closed: boolean
  preview: Point[]
}

interface EdgeInspection {
  edgeCount: number
  edges: EdgePreview[]
  curve?: EdgeCurve
  reason: string | null
}

interface EdgeRequest {
  nativeTransform?: Mat4
  projectTransform?: { position: Vec3; rotation: Vec3; scale: number }
  offset?: number
  limit?: number
  edgeIndex?: number
}

const PREVIEW_SEGMENTS = 32
const UNSUPPORTED = 'The Rhino source does not contain a valid retained solid.'

function xyz(p: readonly number[]): Point {
  return [p[0]!, p[1]!, p[2]!]
}

function checkPlacement(matrix: Mat4): void {
  if (
    matrix.length !== 16 ||
    Array.from(matrix).some((value) => !Number.isFinite(value)) ||
    matrix[3] !== 0 ||
    matrix[7] !== 0 ||
    matrix[11] !== 0 ||
    matrix[15] !== 1
  )
    throw new Error('The Rhino edge has an invalid placement.')
  const basis = [0, 4, 8].map((i) => xyz(matrix.slice(i, i + 3)))
  const norms = basis.map(length)
  if (norms.some((value) => !Number.isFinite(value) || value <= 1e-12))
    throw new Error('The Rhino edge placement collapses geometry.')
  const [a, b, c] = basis.map((axis, i) => scale(axis, 1 / norms[i]!)) as [Vec3, Vec3, Vec3]
  if (Math.abs(dot(a, cross(b, c))) <= 1e-12)
    throw new Error('The Rhino edge placement collapses geometry.')
}

function previewEdge(
  edge: BrepEdge,
  closed: boolean,
  place: (p: readonly number[]) => Point,
): Point[] {
  const [start, end] = edge.domain as [number, number]
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new Error('This Rhino edge has an invalid parameter interval.')
  const linear = !closed && edge.degree === 1 && edge.spanCount === 1
  const steps = linear ? 1 : PREVIEW_SEGMENTS
  const preview = Array.from({ length: steps + 1 }, (_, i) =>
    place(edge.pointAt(i === steps ? end : start + ((end - start) * i) / steps)),
  )
  if (closed) preview[steps] = preview[0]!
  return preview
}

/** Inspect either a bounded page of the native wireframe or one exact placed edge. */
export async function inspectRhinoEdges(
  nativeBytes: Uint8Array,
  request: EdgeRequest = {},
): Promise<EdgeInspection> {
  const {
    edgeIndex,
    nativeTransform = IDENTITY,
    projectTransform,
    offset = 0,
    limit = 30,
  } = request
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_RHINO_EDGE_PAGE_SIZE
  )
    throw new Error('The Rhino edge page is outside the supported range.')
  if (edgeIndex !== undefined && (!Number.isSafeInteger(edgeIndex) || edgeIndex < 0))
    throw new Error('The Rhino edge index is invalid.')
  if (nativeBytes.byteLength > MAX_RHINO_FILE_BYTES)
    throw new Error('The Rhino source is too large.')
  checkPlacement(nativeTransform)
  const matrix = projectTransform
    ? multiply(
        composeTransform(
          projectTransform.position,
          projectTransform.rotation,
          projectTransform.scale,
        ),
        nativeTransform,
      )
    : nativeTransform
  if (projectTransform) checkPlacement(matrix)
  const place = (p: readonly number[]): Point => {
    const result = xyz(transformPoint(matrix, xyz(p)))
    if (!result.every(Number.isFinite)) throw new Error('The Rhino edge has invalid coordinates.')
    return result
  }

  const rhino = await loadRhino3dm()
  const handles: object[] = []
  const hold = <T extends object | null>(value: T): T => {
    if (value) handles.push(value)
    return value
  }
  try {
    const document = hold(rhino.File3dm.fromByteArray(nativeBytes))
    const unsupported = { edgeCount: 0, edges: [], reason: UNSUPPORTED }
    if (!document) return unsupported
    const objects = hold(document.objects())
    if (
      objects.count !== 1 ||
      hold(document.settings()).modelUnitSystem !== rhino.UnitSystem.Millimeters
    )
      return unsupported
    const part = hold(hold(objects.get(0)).geometry())
    if (!(part instanceof rhino.Brep) || !part.isValid || !part.isSolid) return unsupported
    const edges = hold(part.edges())
    const edgeCount = edges.count
    const readPreview = (edgeIndex: number, edge: BrepEdge): EdgePreview => {
      const closed = edge.isClosed || edge.isPeriodic
      return { edgeIndex, preview: previewEdge(edge, closed, place), closed }
    }
    if (edgeIndex !== undefined) {
      if (edgeIndex >= edgeCount) throw new Error('Choose an existing edge on this Rhino solid.')
      const edge = hold(edges.get(edgeIndex))
      // GetNurbForm on the native edge proxy keeps its trimmed interval and orientation.
      const { degree, knots, controlPoints } = readPlacedCurve(rhino, edge, place)
      return {
        edgeCount,
        edges: [readPreview(edgeIndex, edge)],
        curve: { degree, knots, controlPoints },
        reason: null,
      }
    }

    const page: EdgePreview[] = []
    for (let i = offset; i < Math.min(edgeCount, offset + limit); i++)
      page.push(readPreview(i, hold(edges.get(i))))
    return { edgeCount, edges: page, reason: null }
  } finally {
    for (const value of handles.reverse()) freeRhino(value)
  }
}
