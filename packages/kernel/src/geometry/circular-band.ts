import type { Design } from '@pave/schema'
import { boundsOfPositions, transformTessellation, unionBounds } from '../solid/meshing'
import type { Bounds, Evaluation, Part, StoneInstance } from '../types'
import { type Mat4, multiply, transformPoint, type Vec3 } from './vec'

type Subject = Pick<Evaluation, 'parts' | 'stones'>
const center = (b: Bounds, i: number) => (b.min[i]! + b.max[i]!) / 2

function stoneBox(s: StoneInstance): Bounds {
  const [x, y, z] = s.matrix.slice(12, 15) as [number, number, number]
  const r = Math.max(s.dims.width, s.dims.length, s.dims.depth) / 2
  return { min: [x - r, y - r, z - r], max: [x + r, y + r, z + r] }
}

/** The principal horizontal direction of the component centres, independent of CAD orientation. */
function rowDirection(boxes: Bounds[]) {
  const meanX = boxes.reduce((sum, b) => sum + center(b, 0), 0) / boxes.length
  const meanY = boxes.reduce((sum, b) => sum + center(b, 1), 0) / boxes.length
  let xx = 0
  let yy = 0
  let xy = 0
  for (const box of boxes) {
    const x = center(box, 0) - meanX
    const y = center(box, 1) - meanY
    xx += x * x
    yy += y * y
    xy += x * y
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

/** Only offer articulation for a long, flat row of separate components. All distances are in mm. */
export function circularBandLayout({ parts, stones }: Subject) {
  if (parts.length + stones.length < 4) return null
  const boxes = [...parts.map((p) => p.bounds), ...stones.map(stoneBox)]
  const direction = rowDirection(boxes)
  const bounds = unionBounds(boxes)
  const { x, y } = direction
  let minSide = Infinity
  let maxSide = -Infinity
  let minAlong = Infinity
  let maxAlong = -Infinity
  let longestBody = 0
  const intervals = new Map<string, { min: number; max: number }>()
  for (const part of parts) {
    const positions = part.mesh.positions
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < positions.length; i += 3) {
      const vx = positions[i]!,
        vy = positions[i + 1]!
      const along = x * vx + y * vy
      const side = -y * vx + x * vy
      min = Math.min(min, along)
      max = Math.max(max, along)
      minSide = Math.min(minSide, side)
      maxSide = Math.max(maxSide, side)
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null
    intervals.set(part.id, { min, max })
    minAlong = Math.min(minAlong, min)
    maxAlong = Math.max(maxAlong, max)
    longestBody = Math.max(longestBody, max - min)
  }
  for (const stone of stones) {
    const vx = stone.matrix[12]!,
      vy = stone.matrix[13]!
    const radius = Math.max(stone.dims.width, stone.dims.length, stone.dims.depth) / 2
    const along = x * vx + y * vy
    const side = -y * vx + x * vy
    minAlong = Math.min(minAlong, along - radius)
    maxAlong = Math.max(maxAlong, along + radius)
    minSide = Math.min(minSide, side - radius)
    maxSide = Math.max(maxSide, side + radius)
    longestBody = Math.max(longestBody, 2 * radius)
  }
  const length = maxAlong - minAlong
  if (!(length > 0 && length >= 3 * Math.max(maxSide - minSide, bounds.max[2] - bounds.min[2])))
    return null
  if (longestBody > length / 3) return null
  return {
    direction,
    midAlong: (minAlong + maxAlong) / 2,
    midSide: (minSide + maxSide) / 2,
    length,
    intervals,
    bounds,
    diameterMm: length / Math.PI,
  }
}
type Layout = NonNullable<ReturnType<typeof circularBandLayout>>

/** Map the row tangent to a circle tangent, its width to the vertical axis and its top radially outward. */
function frame(layout: Layout, anchor: number): Mat4 {
  const { direction, midAlong, midSide, bounds, diameterMm } = layout
  const radius = diameterMm / 2
  const angle = (anchor - midAlong) / radius
  const sin = Math.sin(angle),
    cos = Math.cos(angle)
  const dx = direction.x,
    dy = direction.y
  const x: Vec3 = [dx * cos, dx * sin, -dy]
  const y: Vec3 = [dy * cos, dy * sin, dx]
  const outward: Vec3 = [sin, -cos, 0]
  const pivot: Vec3 = [dx * anchor - dy * midSide, dy * anchor + dx * midSide, center(bounds, 2)]
  const destination: Vec3 = [
    dx * midAlong - dy * midSide + radius * sin,
    dy * midAlong + dx * midSide - radius * cos,
    center(bounds, 2),
  ]
  const translation = destination.map(
    (value, i) => value - x[i]! * pivot[0] - y[i]! * pivot[1] - outward[i]! * pivot[2],
  )
  return [...x, 0, ...y, 0, ...outward, 0, ...translation, 1]
}

function sourceGroup(p: Part, design: Design | null) {
  const node = design?.nodes[p.nodeId]
  if (node?.kind !== 'meshBody' || node.source.type !== 'asset') return
  const ctx = node.source.rhinoContext
  if (!ctx) return
  const group = ctx.groups.at(-1)?.id
  // Source groups often bind the stone, claws and basket across separate block occurrences.
  if (group) return JSON.stringify([ctx.archiveId, group])
  const occurrence = ctx.placements[0]?.id
  if (occurrence) return JSON.stringify([ctx.archiveId, 'block', occurrence])
}

/** Pose a fresh render evaluation. The modeling graph, manufacturing facts, and cached meshes remain independent. */
export function poseCircularBand(evaluation: Evaluation, design: Design | null): Evaluation {
  const layout = circularBandLayout(evaluation)
  if (!layout) return evaluation
  const groups = new Map<string, { min: number; max: number; gemSum: number; gems: number }>()
  const keys = evaluation.parts.map((p) => sourceGroup(p, design))
  for (const [i, p] of evaluation.parts.entries()) {
    const key = keys[i]
    if (!key) continue
    const g = groups.get(key) ?? { min: Infinity, max: -Infinity, gemSum: 0, gems: 0 }
    const interval = layout.intervals.get(p.id)!
    g.min = Math.min(g.min, interval.min)
    g.max = Math.max(g.max, interval.max)
    if (p.sourceAppearance?.kind === 'gem') {
      g.gemSum += (interval.min + interval.max) / 2
      g.gems++
    }
    groups.set(key, g)
  }
  const parts = evaluation.parts.map((p, i) => {
    const group = groups.get(keys[i] ?? '')
    const interval = layout.intervals.get(p.id)!
    const anchor =
      group && group.max - group.min <= layout.length / 3
        ? group.gems
          ? group.gemSum / group.gems
          : (group.min + group.max) / 2
        : (interval.min + interval.max) / 2
    const transform = frame(layout, anchor)
    const posed = transformTessellation(transform, p)
    return {
      ...p,
      ...posed,
      rev: JSON.stringify([p.rev, transform]),
      bounds: boundsOfPositions(posed.mesh.positions),
    }
  })
  const stones = evaluation.stones.map((s) => ({
    ...s,
    matrix: Array.from(
      multiply(
        frame(layout, s.matrix[12]! * layout.direction.x + s.matrix[13]! * layout.direction.y),
        s.matrix,
      ),
    ),
  }))
  const boxes = parts.map((p) => p.bounds)
  for (const stone of stones) {
    const mesh = evaluation.gemMeshes[stone.meshKey]
    if (!mesh) {
      boxes.push(stoneBox(stone))
      continue
    }
    const positions = new Float32Array(mesh.positions.length)
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const v = mesh.positions
      positions.set(transformPoint(stone.matrix, [v[i]!, v[i + 1]!, v[i + 2]!]), i)
    }
    boxes.push(boundsOfPositions(positions))
  }
  return {
    ...evaluation,
    parts,
    stones,
    curves: [],
    prongTips: [],
    report: { ...evaluation.report, bounds: unionBounds(boxes) },
  }
}
