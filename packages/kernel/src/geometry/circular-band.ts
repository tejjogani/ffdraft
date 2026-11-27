import type { Design } from '@pave/schema'
import { boundsOfPositions, transformTessellation, unionBounds } from '../solid/meshing'
import type { Bounds, Evaluation, Part, StoneInstance } from '../types'
import { multiply, transformPoint, type Mat4, type Vec3 } from './vec'

type Subject = Pick<Evaluation, 'parts' | 'stones'>
const center = (b: Bounds, i: number) => (b.min[i]! + b.max[i]!) / 2

function stoneBox(s: StoneInstance): Bounds {
  const [x, y, z] = s.matrix.slice(12, 15) as [number, number, number]
  const r = Math.max(s.dims.width, s.dims.length, s.dims.depth) / 2
  return { min: [x - r, y - r, z - r], max: [x + r, y + r, z + r] }
}

/** Only offer articulation for a long, flat row of separate components. All distances are in mm. */
export function circularBandLayout({ parts, stones }: Subject) {
  if (parts.length + stones.length < 4) return null
  const boxes = [...parts.map((p) => p.bounds), ...stones.map(stoneBox)]
  const bounds = unionBounds(boxes)
  const spans = bounds.max.map((max, i) => max - bounds.min[i]!)
  const axis = spans[0]! >= spans[1]! ? 0 : 1
  const side = axis === 0 ? 1 : 0
  const length = spans[axis]!
  if (!(length > 0 && length >= 3 * Math.max(spans[side]!, spans[2]!))) return null
  if (boxes.some((b) => b.max[axis] - b.min[axis] > length / 3)) return null
  return { axis, side, length, bounds, diameterMm: length / Math.PI } as const
}
type Layout = NonNullable<ReturnType<typeof circularBandLayout>>

/** Each source station is moved with one rotation and translation. Its local top faces outwards. */
function frame(layout: Layout, anchor: number): Mat4 {
  const { axis, side, bounds, diameterMm } = layout
  const radius = diameterMm / 2
  const angle = (anchor - center(bounds, axis)) / radius
  const s = Math.sin(angle),
    c = Math.cos(angle)
  const tangent: Vec3 = [c, s, 0],
    outward: Vec3 = [s, -c, 0]
  const x: Vec3 = axis === 0 ? tangent : [0, 0, -1]
  const y: Vec3 = axis === 0 ? [0, 0, 1] : tangent
  const mid: Vec3 = [center(bounds, 0), center(bounds, 1), center(bounds, 2)]
  const pivot: Vec3 = axis === 0 ? [anchor, mid[side], mid[2]] : [mid[side], anchor, mid[2]]
  const destination: Vec3 = [mid[0] + radius * s, mid[1] - radius * c, mid[2]]
  const t = destination.map(
    (value, i) => value - x[i]! * pivot[0] - y[i]! * pivot[1] - outward[i]! * pivot[2],
  )
  return [...x, 0, ...y, 0, ...outward, 0, ...t, 1]
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
    g.min = Math.min(g.min, p.bounds.min[layout.axis])
    g.max = Math.max(g.max, p.bounds.max[layout.axis])
    if (p.sourceAppearance?.kind === 'gem') {
      g.gemSum += center(p.bounds, layout.axis)
      g.gems++
    }
    groups.set(key, g)
  }
  const parts = evaluation.parts.map((p, i) => {
    const group = groups.get(keys[i] ?? '')
    const anchor =
      group && group.max - group.min <= layout.length / 3
        ? group.gems
          ? group.gemSum / group.gems
          : (group.min + group.max) / 2
        : center(p.bounds, layout.axis)
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
    matrix: Array.from(multiply(frame(layout, s.matrix[12 + layout.axis]!), s.matrix)),
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
