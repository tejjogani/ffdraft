import { MeshVertexEdits } from '@pave/schema'
import { cross, dot, length, lerp3, sub, type Vec3 } from '../geometry/vec'
import type { IndexedTriangles } from '../solid/meshing'
import { parseMesh } from './parse/index'

const point = (p: Float32Array, id: number): Vec3 => [p[id * 3]!, p[id * 3 + 1]!, p[id * 3 + 2]!]

/**
 * An indexed measured mesh, in source millimetres. A vertex id is the first triangle occurrence
 * of its exact position, counted from zero. Triangle order and winding match the source parser.
 * Edits are absolute positions for those ids. Repair, placement, and transforms happen later.
 */
export function readEditableMesh(bytes: Uint8Array, edits?: MeshVertexEdits): IndexedTriangles {
  return applyMeshVertexEdits(parseMesh(bytes).mesh, edits)
}

export function applyMeshVertexEdits(
  source: IndexedTriangles,
  edits?: MeshVertexEdits,
): IndexedTriangles {
  const parsed = edits === undefined ? undefined : MeshVertexEdits.safeParse(edits)
  if (parsed && !parsed.success)
    throw new Error('Invalid mesh vertex edits', { cause: parsed.error })

  const idsByPosition = new Map<string, number>()
  const unique = new Float32Array(Math.min(source.positions.length, source.indices.length * 3))
  const indices = source.indices.map((sourceId) => {
    if (sourceId >= source.positions.length / 3)
      throw new Error('The source mesh references a missing vertex')
    const position = point(source.positions, sourceId)
    const key = position.join(',')
    const known = idsByPosition.get(key)
    if (known !== undefined) return known
    const id = idsByPosition.size
    idsByPosition.set(key, id)
    unique.set(position, id * 3)
    return id
  })
  const positions = unique.slice(0, idsByPosition.size * 3)
  const targets = Object.entries(parsed?.data ?? {})
  if (targets.length === 0) return { positions, indices }

  // Keep ids stable across the move. Remove all old positions before checking the final locations
  // so an edge or a face can move several of its vertices into each other's original positions.
  const before = positions.slice()
  const changed = new Set<number>()
  for (const [key, position] of targets) {
    const id = Number(key)
    if (id >= positions.length / 3) throw new Error(`Mesh vertex ${id} is not in the source asset`)
    const old = point(before, id)
    positions.set(position, id * 3)
    if (old.every((value, axis) => value === positions[id * 3 + axis])) continue
    changed.add(id)
    idsByPosition.delete(old.join(','))
  }
  for (const id of changed) {
    const key = point(positions, id).join(',')
    if (idsByPosition.has(key))
      throw new Error(`Moving mesh vertex ${id} collapses it onto another source vertex`)
    idsByPosition.set(key, id)
  }
  checkTriangles(before, positions, indices, changed)
  return { positions, indices }
}

const AREA_EPSILON = 64 * Number.EPSILON

function collapsed(u: Vec3, v: Vec3, normal: Vec3): boolean {
  return length(normal) <= AREA_EPSILON * Math.max(dot(u, u), dot(v, v))
}

/** Zero-area faces can appear when deformed coordinates are rounded to mesh precision. */
export function checkDeformedTriangleAreas({ positions, indices }: IndexedTriangles): void {
  if (!positions.every(Number.isFinite))
    throw new Error('The deformation moves mesh vertices out of range')
  for (let i = 0; i < indices.length; i += 3) {
    const a = point(positions, indices[i]!)
    const u = sub(point(positions, indices[i + 1]!), a)
    const v = sub(point(positions, indices[i + 2]!), a)
    if (collapsed(u, v, cross(u, v)))
      throw new Error(`The deformation collapses mesh triangle ${i / 3}`)
  }
}

/** Roots of a quadratic on the edit path, using a formula that retains the smaller root. */
function roots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) <= AREA_EPSILON * Math.abs(b)) return b === 0 ? [] : [-c / b]
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c))
  const [an, bn, cn] = [a / scale, b / scale, c / scale]
  const product = 4 * an * cn
  const discriminant = bn * bn - product
  if (discriminant < -AREA_EPSILON * (bn * bn + Math.abs(product))) return []
  const d = Math.sqrt(Math.max(0, discriminant))
  const q = -0.5 * (bn + (bn < 0 ? -d : d))
  return q === 0 ? [0] : [q / an, cn / q]
}

function checkTriangles(
  before: Float32Array,
  after: Float32Array,
  indices: Uint32Array,
  changed: ReadonlySet<number>,
) {
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!
    const b = indices[i + 1]!
    const c = indices[i + 2]!
    if (!changed.has(a) && !changed.has(b) && !changed.has(c)) continue

    const nextA = point(after, a)
    const nextU = sub(point(after, b), nextA)
    const nextV = sub(point(after, c), nextA)
    const nextNormal = cross(nextU, nextV)
    if (collapsed(nextU, nextV, nextNormal))
      throw new Error(`The edit collapses mesh triangle ${i / 3}`)

    const oldA = point(before, a)
    const oldU = sub(point(before, b), oldA)
    const oldV = sub(point(before, c), oldA)
    const oldNormal = cross(oldU, oldV)
    if (collapsed(oldU, oldV, oldNormal)) continue
    // Along a simultaneous linear move the area vector is quadratic in t. Test it where its
    // projection on the old normal vanishes. A valid 3D fold can cross that plane with area.
    const du = sub(nextU, oldU)
    const dv = sub(nextV, oldV)
    const quadratic = dot(oldNormal, cross(du, dv))
    const constant = dot(oldNormal, oldNormal)
    const linear = dot(oldNormal, nextNormal) - constant - quadratic
    for (const t of roots(quadratic, linear, constant)) {
      if (t <= 0 || t >= 1) continue
      const u = lerp3(oldU, nextU, t)
      const v = lerp3(oldV, nextV, t)
      if (collapsed(u, v, cross(u, v))) throw new Error(`The edit inverts mesh triangle ${i / 3}`)
    }
  }
}
