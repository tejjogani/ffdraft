/**
 * What the resolver needs to know about the piece — a summary of an Evaluation that the server
 * can store and send without meshes.
 */
import type { Bounds, Evaluation, Part, StoneInstance } from '@pave/kernel/types'
import { add, length, normalize, scale, sub, type Vec3 } from './math'

export interface SceneSubject {
  bounds: Bounds
  /**
   * Support points of the geometry (its extreme vertices in 26 directions), so presets frame
   * the real silhouette rather than the bounding box — a ring is far from box-shaped. Optional:
   * without them the bounding-box corners are framed.
   */
  silhouette?: Vec3[]
  parts: Pick<Part, 'id' | 'nodeId' | 'material' | 'finish' | 'plating' | 'bounds'>[]
  stones: Pick<StoneInstance, 'id' | 'nodeId' | 'stone' | 'role' | 'matrix'>[]
}

/** The 26 directions of a cube's faces, edges and corners. */
const DIRECTIONS: Vec3[] = []
for (let x = -1; x <= 1; x++)
  for (let y = -1; y <= 1; y++)
    for (let z = -1; z <= 1; z++) if (x || y || z) DIRECTIONS.push([x, y, z])

function supportPoints(e: Evaluation): Vec3[] {
  const best = DIRECTIONS.map(() => ({ score: -Infinity, point: [0, 0, 0] as Vec3 }))
  const visit = (p: Vec3) => {
    DIRECTIONS.forEach((d, i) => {
      const score = d[0] * p[0] + d[1] * p[1] + d[2] * p[2]
      if (score > best[i]!.score) best[i] = { score, point: p }
    })
  }
  for (const part of e.parts) {
    const pos = part.mesh.positions
    for (let i = 0; i < pos.length; i += 3) visit([pos[i]!, pos[i + 1]!, pos[i + 2]!])
  }
  for (const s of e.stones) {
    const c = stoneCenter(s)
    const r = stoneWidth(s) / 2
    for (const d of DIRECTIONS) visit(add(c, scale(normalize(d), r)))
  }
  return best.map((b) => b.point)
}

export function subjectOf(input: Evaluation | SceneSubject): SceneSubject {
  if (!('report' in input)) return input
  return {
    bounds: input.report.bounds,
    silhouette: supportPoints(input),
    parts: input.parts.map(({ id, nodeId, material, finish, plating, bounds }) => ({
      id,
      nodeId,
      material,
      finish,
      plating,
      bounds,
    })),
    stones: input.stones.map(({ id, nodeId, stone, role, matrix }) => ({
      id,
      nodeId,
      stone,
      role,
      matrix,
    })),
  }
}

export const boundsCenter = (b: Bounds): Vec3 => [
  (b.min[0] + b.max[0]) / 2,
  (b.min[1] + b.max[1]) / 2,
  (b.min[2] + b.max[2]) / 2,
]

/** Half the bounds diagonal: the unit rigs are scaled by. */
export const boundsRadius = (b: Bounds): number => Math.max(0.5, length(sub(b.max, b.min)) / 2)

export const stoneCenter = (s: Pick<StoneInstance, 'matrix'>): Vec3 => [
  s.matrix[12]!,
  s.matrix[13]!,
  s.matrix[14]!,
]

/** Girdle width of an instanced stone: the unit mesh is 1 wide, so it is the X column's length. */
export const stoneWidth = (s: Pick<StoneInstance, 'matrix'>): number =>
  Math.hypot(s.matrix[0]!, s.matrix[1]!, s.matrix[2]!)
