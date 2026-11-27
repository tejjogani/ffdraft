import { MAX_RHINO_EDGE_PAGE_SIZE } from '@pave/schema'
import type { BrepEdge } from 'rhino3dm'
import { type PlacedRhinoCurve, readPlacedCurve } from './rhino-curve'
import {
  type RhinoPlacement,
  type RhinoPoint,
  readRetainedRhinoSolid,
  rhinoPlacement,
} from './rhino-solid'

type EdgeCurve = Pick<PlacedRhinoCurve, 'degree' | 'knots' | 'controlPoints'>

interface EdgePreview {
  edgeIndex: number
  closed: boolean
  preview: RhinoPoint[]
}

interface EdgeInspection {
  edgeCount: number
  edges: EdgePreview[]
  curve?: EdgeCurve
  reason: string | null
}

interface EdgeRequest extends RhinoPlacement {
  offset?: number
  limit?: number
  edgeIndex?: number
}

const PREVIEW_SEGMENTS = 32
const UNSUPPORTED = 'The Rhino source does not contain a valid retained solid.'

function previewEdge(
  edge: BrepEdge,
  closed: boolean,
  place: (p: readonly number[]) => RhinoPoint,
): RhinoPoint[] {
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
  const { edgeIndex, offset = 0, limit = 30 } = request
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
  const { place } = rhinoPlacement(request)
  const result = await readRetainedRhinoSolid<EdgeInspection>(nativeBytes, (rhino, part, hold) => {
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
  })
  return result ?? { edgeCount: 0, edges: [], reason: UNSUPPORTED }
}
